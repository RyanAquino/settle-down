import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { CI_RUNTIME, prepareRuntime } from '../runtime-preparation.mjs';

const pinned = {
  identifier: CI_RUNTIME.identifier,
  version: CI_RUNTIME.version,
  buildversion: '23F77',
  isAvailable: true,
};
const other = {
  identifier: 'com.apple.CoreSimulator.SimRuntime.iOS-27-0',
  version: '27.0',
  buildversion: '24A434',
  isAvailable: true,
};

async function harness(t, runtimes, coreSimulator = '1051.55') {
  const evidence = await mkdtemp(path.join(os.tmpdir(), 'runtime-preparation-'));
  t.after(() => rm(evidence, { recursive: true, force: true }));
  const run = async (command, args) => {
    if (command === 'plutil') return { output: coreSimulator };
    assert.equal(command, 'xcrun');
    assert.deepEqual(args, ['simctl', 'list', 'runtimes', '-j']);
    return { output: JSON.stringify({ runtimes }) };
  };
  return {
    input: { run, evidence },
    record: async () => JSON.parse(await readFile(`${evidence}/runtime-preparation.json`, 'utf8')),
  };
}

test('verification selects the preinstalled pinned runtime and records a reissued Apple build', async (t) => {
  const h = await harness(t, [other, pinned]);
  const result = await prepareRuntime(h.input);
  assert.deepEqual(result, {
    identifier: CI_RUNTIME.identifier,
    status: 'ready',
    coreSimulator: '1051.55',
    version: '26.5',
    build: '23F77',
  });
  assert.deepEqual(await h.record(), result);
});

test('a missing or unavailable pinned runtime blocks verification', async (t) => {
  for (const runtimes of [[other], [other, { ...pinned, isAvailable: false }]]) {
    const h = await harness(t, runtimes);
    await assert.rejects(prepareRuntime(h.input), /is unavailable on this runner/);
    assert.equal((await h.record()).status, 'blocked');
  }
});

test('the pinned runtime must report the requested OS and its build metadata', async (t) => {
  for (const [runtime, error] of [
    [{ ...pinned, version: '26.6' }, /Expected iOS 26.5; found 26.6/],
    [{ ...pinned, buildversion: '' }, /missing its build metadata/],
  ]) {
    const h = await harness(t, [runtime]);
    await assert.rejects(prepareRuntime(h.input), error);
    assert.equal((await h.record()).status, 'blocked');
  }
});

test('local verification can select an explicitly requested installed runtime', async (t) => {
  const h = await harness(t, [pinned, other]);
  const result = await prepareRuntime({ ...h.input, runtime: other.identifier });
  assert.equal(result.identifier, other.identifier);
  assert.equal(result.version, other.version);
});

test('a missing CoreSimulator version is recorded as a setup error', async (t) => {
  const h = await harness(t, [pinned], '');
  await assert.rejects(prepareRuntime(h.input), /Could not determine the CoreSimulator version/);
  assert.equal((await h.record()).status, 'blocked');
});
