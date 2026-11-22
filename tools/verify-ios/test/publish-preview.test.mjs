import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { Script } from 'node:vm';
import { parse } from 'yaml';

const workflow = new URL('../../../.github/workflows/publish-preview.yml', import.meta.url);
const { prepare, release, publish } = parse(await readFile(workflow, 'utf8')).jobs;
const gate = prepare.steps.find(
  (step) => step.name === 'Require successful main CI before staging',
);
const script = new Script(`(async () => { ${gate.with.script} })()`, {
  filename: workflow.pathname,
});
const dispatchSha = 'a'.repeat(40);
const currentMain = 'b'.repeat(40);

function passed(workflow) {
  return {
    path: `.github/workflows/${workflow}.yml`,
    name: workflow,
    run_number: 1,
    status: 'completed',
    conclusion: 'success',
    html_url: `https://example.test/runs/${workflow}`,
  };
}

async function check(runs, releaseTag = '') {
  const errors = [];
  const repo = { owner: 'owner', repo: 'repo' };
  await script.runInNewContext({
    context: { repo, sha: dispatchSha, payload: { inputs: { release_tag: releaseTag } } },
    core: { setFailed: (message) => errors.push(message) },
    github: {
      rest: {
        actions: { listWorkflowRunsForRepo: 'runs' },
        git: {
          getRef: async (params) => {
            assert.deepEqual({ ...params }, { ...repo, ref: 'heads/main' });
            return { data: { object: { sha: currentMain } } };
          },
        },
      },
      paginate: async (route, params) => {
        assert.equal(route, 'runs');
        assert.deepEqual(
          { ...params },
          {
            ...repo,
            branch: 'main',
            event: 'push',
            head_sha: releaseTag ? currentMain : dispatchSha,
            per_page: 100,
          },
        );
        return runs;
      },
    },
  });
  return errors;
}

test('releases and restores require a successful latest push run for every main workflow', async () => {
  const green = ['quality', 'native', 'security'].map(passed);
  assert.deepEqual(await check(green), []);
  assert.deepEqual(await check(green, `expo-preview-${'c'.repeat(40)}`), []);

  const failed = { ...passed('native'), run_number: 2, conclusion: 'failure' };
  const pending = { ...passed('additional'), status: 'queued', conclusion: null };
  const errors = await check([failed, pending, ...green]);
  assert.equal(errors.length, 2);
  assert.ok(
    errors.some((error) => error.includes('native: failure') && error.includes(failed.html_url)),
  );
  assert.ok(
    errors.some(
      (error) => error.includes('additional: queued') && error.includes(pending.html_url),
    ),
  );
});

test('a restore reports cancelled and missing main workflows even when Quality passed', async () => {
  const cancelled = { ...passed('native'), conclusion: 'cancelled' };
  const errors = await check([passed('quality'), cancelled], 'previous-preview');
  assert.equal(errors.length, 2);
  assert.ok(errors.every((error) => error.includes(currentMain)));
  assert.ok(errors.some((error) => error.includes('native: cancelled')));
  assert.ok(
    errors.some((error) => error.includes('No push run found for .github/workflows/security.yml')),
  );
});

test('each job checks CI before its release side effect, including partial retries', () => {
  for (const [job, command] of [
    [prepare, 'stage-expo-preview.sh'],
    [release, 'gh release create'],
    [publish, 'eas update:republish'],
  ]) {
    const gateIndex = job.steps.findIndex((step) => step.with?.script === gate.with.script);
    assert.ok(
      gateIndex >= 0 && gateIndex < job.steps.findIndex((step) => step.run?.includes(command)),
    );
    assert.equal(job.steps[gateIndex].if, job === prepare ? 'steps.select.outputs.tag' : undefined);
  }
});
