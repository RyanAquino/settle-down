import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { preparePreviews } from '../prepare-previews.mjs';
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
