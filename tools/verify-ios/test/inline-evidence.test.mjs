import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { preparePreviews } from '../prepare-previews.mjs';
import { publishPreviewImages } from '../preview-branch.mjs';
import { inlineEvidence } from '../inline-evidence.mjs';

const png = Buffer.from('89504e470d0a1a0a', 'hex');
const url = 'https://github.com/user-attachments/assets/abcd1234-abcd-1234-abcd-123456789abc';
const scenario = {
  id: 'split',
  name: 'Receipt split',
  coverage: 'Inspect the split',
  fixture: 'success',
  status: 'FAIL',
};
async function temporary(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'inline-evidence-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test('stage captured and failure screenshots only from the identified replay', async (t) => {
  const root = await temporary(t);
  const evidence = path.join(root, 'evidence');
  const run = path.join(evidence, 'replay/split/dated-run/flow');
  await mkdir(path.join(run, 'takeScreenshot'), { recursive: true });
  await mkdir(path.join(run, 'screenshots'));
  await writeFile(
    path.join(evidence, 'result.json'),
    JSON.stringify({
      version: 1,
      headSha: 'a'.repeat(40),
      agentCompleted: true,
      disposition: 'ready',
      verdict: 'FAIL',
      limitations: [],
      deviceOnly: [],
      scenarios: [scenario],
    }),
  );
  await writeFile(path.join(run, 'takeScreenshot/amount.png'), png);
  await writeFile(path.join(run, 'screenshots/step-4-assertVisible.png'), png);
  await writeFile(path.join(root, 'outside.png'), png);
  await symlink(path.join(root, 'outside.png'), path.join(run, 'takeScreenshot/link.png'));
  await writeFile(
    path.join(run, 'commands.json'),
    JSON.stringify([
      {
        metadata: {
          status: 'COMPLETED',
          artifacts: [
            { path: 'takeScreenshot/amount.png' },
            { path: 'takeScreenshot/link.png' },
            { path: '../../outside.png' },
          ],
        },
      },
      {
        metadata: {
          status: 'FAILED',
          artifacts: [{ path: 'screenshots/step-4-assertVisible.png' }],
        },
      },
    ]),
  );
  const previews = path.join(root, 'previews');
  await preparePreviews(evidence, previews);
  assert.deepEqual((await readdir(previews)).sort(), ['split.amount.png', 'split.failed-step.png']);
  assert.deepEqual(await readFile(path.join(previews, 'split.amount.png')), png);
});

test('native uploads render a player and image, preserve previous uploads on retry and reject foreign URLs', async (t) => {
  const directory = await temporary(t);
  await writeFile(path.join(directory, 'split.amount.png'), png);
  await writeFile(path.join(directory, 'other.unrelated.png'), png);
  await writeFile(path.join(directory, 'split.replay.mp4'), Buffer.from('\0\0\0\u0018ftypmp42'));
  const warnings = [],
    calls = [];
  const input = {
    directory,
    scenarios: [scenario],
    token: 'synthetic',
    repoId: 123,
    warn: (w) => warnings.push(w),
  };
  const upload = async (endpoint, init) => {
    assert.equal(endpoint.origin, 'https://uploads.github.com');
    assert.equal(endpoint.searchParams.get('repository_id'), '123');
    assert.equal(init.headers.Authorization, 'Bearer synthetic');
    assert.equal(init.redirect, 'error');
    calls.push(endpoint.searchParams.get('name'));
    return { ok: true, json: async () => ({ url }) };
  };
  const first = await inlineEvidence({
    ...input,
    fetchImpl: async (endpoint, init) =>
      endpoint.searchParams.get('content_type') === 'video/mp4'
        ? { ok: false, status: 403 }
        : upload(endpoint, init),
  });
  assert.ok(first.includes('![split / amount](' + url + ')'));
  assert.ok(first.includes('could not be published'));
  const full = await inlineEvidence({ ...input, previous: first, fetchImpl: upload });
  assert.ok(full.includes('**Replay clip / split**\n\n' + url + '\n'));
  assert.deepEqual(calls, ['split.amount.png', 'split.replay.mp4']);
  assert.equal(
    await inlineEvidence({ ...input, previous: full, token: '', fetchImpl: upload }),
    full,
  );
  assert.equal(calls.length, 2);
  const foreignUrl = 'https://github.com.example.org' + new URL(url).pathname;
  const invalid = await inlineEvidence({
    ...input,
    fetchImpl: async () => ({ ok: true, json: async () => ({ url: foreignUrl }) }),
  });
  assert.equal(
    invalid,
    'Some inline previews could not be published. See the evidence archive below.',
  );
  assert.ok(warnings.some((w) => w.includes('HTTP 403')));
  const disabled = await inlineEvidence({ ...input, token: '', fetchImpl: upload });
  assert.ok(disabled.includes('evidence archive'));
  assert.equal(calls.length, 2);
});

test('a 403 or absent token embeds captured PNGs and animated replays at a pinned commit', async (t) => {
  const directory = await temporary(t);
  const gif = Buffer.from('GIF89a');
  await writeFile(path.join(directory, 'split.amount.png'), png);
  await writeFile(path.join(directory, 'split.replay.mp4'), Buffer.from('\0\0\0\u0018ftypmp42'));
  await writeFile(path.join(directory, 'split.replay.gif'), gif);
  await writeFile(path.join(directory, 'other.amount.png'), png);
  const sha = 'a'.repeat(40);
  const input = {
    directory,
    scenarios: [scenario],
    repoId: 123,
    repository: 'owner/repo',
    runId: 456,
    attempt: 2,
    warn: () => {},
    fetchImpl: async () => ({ ok: false, status: 403 }),
    publishImages: async (files) => {
      assert.deepEqual(
        files.map(({ name, data }) => [name, data]),
        [
          ['split.amount.png', png],
          ['split.replay.gif', gif],
        ],
      );
      return sha;
    },
  };
  const output = await inlineEvidence({ ...input, token: 'synthetic' });
  assert.equal(output, await inlineEvidence(input));
  assert.ok(
    output.includes(
      '![Replay clip / split](https://github.com/owner/repo/blob/' +
        sha +
        '/456/2/split.replay.gif?raw=true)',
    ),
  );
  assert.ok(output.includes('![split / amount]('));
  assert.ok(!output.includes('could not be published'));
  assert.equal(
    await inlineEvidence({ ...input, previous: output, publishImages: assert.fail }),
    output,
  );
  assert.ok(
    !(await inlineEvidence({ ...input, attempt: 3, scenarios: [], previous: output })).includes(
      '/456/2/',
    ),
  );
  assert.match(
    await inlineEvidence({
      ...input,
      publishImages: async () => {
        throw new Error('branch is protected');
      },
    }),
    /evidence archive/,
  );
});

test('concurrent initial report publication retries without replacing another commit', async () => {
  const parents = [];
  const repo = { owner: 'owner', repo: 'repo' };
  const git = {
    createBlob: async ({ content }) => {
      assert.deepEqual(Buffer.from(content, 'base64'), png);
      return { data: { sha: 'blob' } };
    },
    createTree: async ({ tree }) => {
      assert.deepEqual(tree, [
        { path: '456/2/split.amount.png', type: 'blob', mode: '100644', sha: 'blob' },
      ]);
      return { data: { sha: 'tree' } };
    },
    getRef: async () => {
      if (!parents.length) throw Object.assign(new Error(), { status: 404 });
      return { data: { object: { sha: 'concurrent' } } };
    },
    createCommit: async (args) => {
      parents.push(args.parents);
      return { data: { sha: 'commit' } };
    },
    createRef: async () => {
      throw Object.assign(new Error(), { status: 422 });
    },
    updateRef: async (args) => {
      assert.deepEqual(args, {
        ...repo,
        ref: 'heads/ios-verification-media',
        sha: 'commit',
        force: false,
      });
    },
  };
  assert.equal(
    await publishPreviewImages({
      github: { rest: { git } },
      repo,
      runId: 456,
      attempt: 2,
      files: [{ name: 'split.amount.png', data: png }],
    }),
    'commit',
  );
  assert.deepEqual(parents, [[], ['concurrent']]);
});
