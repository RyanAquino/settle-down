import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Script } from 'node:vm';
import { parse } from 'yaml';

const workflow = new URL('../../../.github/workflows/publish-preview.yml', import.meta.url);
const { prepare, release, publish } = parse(await readFile(workflow, 'utf8')).jobs;
const gate = prepare.steps.find((step) => step.with?.script);
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

async function check(snapshots, { releaseTag = '', mainHeads = [currentMain] } = {}) {
  const errors = [];
  const messages = [];
  const delays = [];
  let elapsed = 0;
  let polls = 0;
  const mainHead = () => mainHeads[Math.min(polls, mainHeads.length - 1)];
  const repo = { owner: 'owner', repo: 'repo' };
  await script.runInNewContext({
    Date: { now: () => elapsed },
    setTimeout: (resolve, ms) => {
      assert.ok(ms > 0 && delays.length < 200, 'CI polling must be bounded');
      delays.push(ms);
      elapsed += ms;
      resolve();
    },
    context: { repo, sha: dispatchSha, payload: { inputs: { release_tag: releaseTag } } },
    core: {
      setFailed: (message) => errors.push(message),
      info: (message) => messages.push(message),
    },
    github: {
      rest: {
        actions: { listWorkflowRunsForRepo: 'runs' },
        git: {
          getRef: async (params) => {
            assert.deepEqual({ ...params }, { ...repo, ref: 'heads/main' });
            return { data: { object: { sha: mainHead() } } };
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
            head_sha: releaseTag ? mainHead() : dispatchSha,
            per_page: 100,
          },
        );
        const runs = snapshots[Math.min(polls, snapshots.length - 1)];
        polls++;
        return runs;
      },
    },
  });
  return { errors, messages, delays, polls, elapsed };
}

const green = ['quality', 'native', 'security'].map(passed);
const queued = { ...passed('additional'), status: 'queued', conclusion: null };

test('green CI proceeds immediately for both a new preview and a restore', async () => {
  for (const releaseTag of ['', 'previous-preview']) {
    const result = await check([green], { releaseTag });
    assert.deepEqual(result.errors, []);
    assert.equal(result.polls, 1);
    assert.deepEqual(result.delays, []);
  }
});

test('CI can register late and move from queued to running to success', async () => {
  const active = { ...queued, status: 'in_progress' };
  const result = await check([
    [passed('quality')],
    [...green, queued],
    [...green, active],
    [...green, passed('additional')],
  ]);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.delays, [30_000, 30_000, 30_000]);
  assert.match(result.messages[0], /native.yml has no push run yet/);
  assert.match(result.messages[1], /additional: queued/);
  assert.ok(result.messages[2].includes(active.html_url));
});

test('a newer failed run stops the wait even with other CI still queued', async () => {
  const failed = { ...passed('native'), run_number: 2, conclusion: 'failure' };
  const result = await check([
    [...green, queued],
    [failed, ...green, queued],
  ]);
  assert.deepEqual(result.delays, [30_000]);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /native: failure/);
  assert.ok(result.errors[0].includes(failed.html_url));
});

test('a cancelled workflow immediately blocks a restore even when a required run is missing', async () => {
  const result = await check(
    [[passed('quality'), { ...passed('native'), conclusion: 'cancelled' }]],
    { releaseTag: 'previous-preview' },
  );
  assert.deepEqual(result.delays, []);
  assert.ok(result.errors[0].includes(currentMain));
  assert.match(result.errors[0], /native: cancelled/);
});

test('a restore follows current main when it changes during a wait', async () => {
  const result = await check([[...green, queued], green], {
    releaseTag: 'previous-preview',
    mainHeads: [dispatchSha, currentMain],
  });
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.delays, [30_000]);
  assert.equal(result.polls, 2);
});

test('a timeout names missing and unfinished workflows, including a previously seen run', async () => {
  const active = { ...passed('native'), status: 'in_progress', conclusion: null };
  const result = await check([
    [passed('quality'), active, queued],
    [passed('quality'), active],
  ]);
  assert.equal(result.elapsed, 90 * 60_000);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /Timed out after 90 minutes/);
  assert.match(result.errors[0], /security.yml has no push run yet/);
  assert.match(result.errors[0], /additional.yml has no push run yet/);
  assert.ok(result.errors[0].includes(active.html_url));
});

test('each Expo publish and the final prerelease recheck main CI, including partial retries', () => {
  assert.equal(publish.needs, 'prepare');
  assert.deepEqual(release.needs, ['prepare', 'publish']);
  assert.equal(gate.if, 'steps.select.outputs.tag');
  for (const [job, command] of [
    [release, 'gh release create'],
    [publish, 'eas update --channel preview'],
    [publish, 'eas update:republish --group'],
  ]) {
    const gateIndex = job.steps.findIndex((step) => step.with?.script === gate.with.script);
    assert.ok(
      gateIndex >= 0 && gateIndex < job.steps.findIndex((step) => step.run?.includes(command)),
    );
    assert.equal(job.steps[gateIndex].if, undefined);
  }
});

const update = publish.steps.find((step) => step.id === 'update');
const cli = `
  git() { echo "$COMMIT"; }
  gh() { echo "$MAIN_SHA"; }
  eas() {
    echo "$*" >> "$RUNNER_TEMP/calls"
    if [[ "$1" == update ]]; then echo "$UPDATES"; fi
  }
`;
const tag = `v2.0.0-${dispatchSha}`;
const group = '7bd724a0-312a-4b81-9fc5-a0a7e4f36045';

async function publishPreview(t, overrides = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'publish-preview-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const updates = ['ios', 'android'].map((platform) => ({
    platform,
    group,
    gitCommitHash: dispatchSha,
  }));
  const result = spawnSync('bash', ['-eo', 'pipefail', '-c', cli + update.run], {
    cwd: dir,
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      COMMIT: dispatchSha,
      MAIN_SHA: dispatchSha,
      TAG: tag,
      MODE: 'publish',
      EAS_PROJECT_OWNER: 'org-ryan',
      RUNNER_TEMP: dir,
      UPDATES: JSON.stringify(updates),
      ...overrides,
    },
  });
  return { ...result, dir };
}

test('a new preview uploads directly once and saves the returned group for that project', async (t) => {
  const { dir, status, stderr } = await publishPreview(t);
  assert.equal(status, 0, stderr);
  assert.equal(
    await readFile(join(dir, 'calls'), 'utf8'),
    `update --channel preview --environment preview --platform all --message ${tag} --non-interactive --json\n`,
  );
  assert.deepEqual(JSON.parse(await readFile(join(dir, 'org-ryan.json'), 'utf8')), {
    'org-ryan': group,
  });
  const receipt = publish.steps.find((step) => step.uses?.startsWith('actions/upload-artifact@'));
  assert.equal(receipt.if, "needs.prepare.outputs.mode == 'publish'");
  assert.equal(receipt.with.name, 'preview-group-${{ matrix.owner }}');
  assert.ok(release.if.includes("needs.prepare.outputs.mode == 'publish'"));
});

test('a restore republishes the recorded group without rebuilding or replacing the release manifest', async (t) => {
  const legacyTag = `expo-preview-${dispatchSha}`;
  const { dir, status, stderr } = await publishPreview(t, {
    MODE: 'restore',
    GROUP: group,
    REQUESTED: legacyTag,
    TAG: legacyTag,
    MAIN_SHA: currentMain,
  });
  assert.equal(status, 0, stderr);
  assert.equal(
    await readFile(join(dir, 'calls'), 'utf8'),
    `update:republish --group ${group} --destination-channel preview --platform all --non-interactive --message ${legacyTag}\n`,
  );
  await assert.rejects(readFile(join(dir, 'org-ryan.json')), { code: 'ENOENT' });
});

test('missing restore data and a superseded fresh commit stop before contacting Expo', async (t) => {
  for (const overrides of [{ MODE: 'restore', REQUESTED: tag }, { MAIN_SHA: currentMain }]) {
    const { dir, status } = await publishPreview(t, overrides);
    assert.notEqual(status, 0);
    await assert.rejects(readFile(join(dir, 'calls')), { code: 'ENOENT' });
  }
});

test('a partial platform response fails the project publish', async (t) => {
  const { status, stdout } = await publishPreview(t, {
    UPDATES: JSON.stringify([{ platform: 'ios', group, gitCommitHash: dispatchSha }]),
  });
  assert.notEqual(status, 0);
  assert.match(stdout, /::error::Expo did not return one iOS and Android update group/);
});

test('the release combines both project receipts and can retry without another upload to Expo', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'preview-release-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, 'groups'));
  const record = release.steps.find((step) => step.run?.includes('gh release create'));
  const gh = `
    gh() {
      case "$1 $2" in
        'release view')
          [[ -f recorded.json ]] || return 1
          if [[ "$5" == isDraft ]]; then echo false; else echo true; fi ;;
        'release create') cp expo-groups.json recorded.json ;;
        'release download') cat recorded.json ;;
        'api repos/owner/repo/commits/'*) echo "$COMMIT" ;;
        *) return 1 ;;
      esac
    }
  `;
  const run = () =>
    spawnSync('bash', ['-eo', 'pipefail', '-c', gh + record.run], {
      cwd: dir,
      encoding: 'utf8',
      env: { PATH: process.env.PATH, COMMIT: dispatchSha, TAG: tag, GH_REPO: 'owner/repo' },
    });
  const personal = 'b1a5e609-b24a-40a6-9646-db3c32fef062';
  await writeFile(join(dir, 'groups/org-ryan.json'), JSON.stringify({ 'org-ryan': group }));
  assert.notEqual(run().status, 0);
  await assert.rejects(readFile(join(dir, 'recorded.json')), { code: 'ENOENT' });
  await writeFile(
    join(dir, 'groups/ryan.aquino.json'),
    JSON.stringify({ 'ryan.aquino': personal }),
  );
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = run();
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(await readFile(join(dir, 'recorded.json'), 'utf8')), {
      'org-ryan': group,
      'ryan.aquino': personal,
    });
  }
});
