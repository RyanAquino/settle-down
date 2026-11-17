import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { CI_RUNTIME, prepareRuntime } from '../runtime-preparation.mjs';

async function harness(t, { installed = true, core = '1174.9.2', version = CI_RUNTIME.version, build = '23F73', failDownload = false, failCache = false } = {}) {
  const evidence = await mkdtemp(path.join(os.tmpdir(), 'runtime-preparation-'));
  t.after(() => rm(evidence, { recursive: true, force: true }));
  const calls = [];
  const run = async (command, args, options) => {
    calls.push({ command, args, options });
    if (command === 'plutil') return { output: core };
    if (command === 'xcodebuild') {
      if (failDownload) throw new Error('Runtime download failed');
      installed = true;
      return { output: '' };
    }
    if (args[1] === 'list') return { output: JSON.stringify({ runtimes: installed
      ? [{ identifier: CI_RUNTIME.identifier, isAvailable: true, version, buildversion: build }] : [] }) };
    if (failCache) throw new Error('Runtime cache preparation timed out');
    return { output: '' };
  };
  return { calls, evidence, input: { run, evidence }, record: async () => JSON.parse(await readFile(`${evidence}/runtime-preparation.json`, 'utf8')) };
}

test('an installed pinned runtime prepares only its own cache and records the actual CoreSimulator', async t => {
  const h = await harness(t);
  const result = await prepareRuntime(h.input);
  assert.equal(result.status, 'ready');
  assert.equal(result.coreSimulator, '1174.9.2');
  assert.equal(result.downloaded, false);
  assert.equal(result.cachePrepared, true);
  assert.ok(!h.calls.some(c => c.command === 'xcodebuild'));
  const cache = h.calls.find(c => c.args.includes('dyld_shared_cache'));
  assert.deepEqual(cache.args, ['simctl', 'runtime', 'dyld_shared_cache', 'update', CI_RUNTIME.identifier]);
});

test('CI can install the exact iOS version and architecture, then revalidate it', async t => {
  const h = await harness(t, { installed: false });
  await prepareRuntime({ ...h.input, allowDownload: true });
  const download = h.calls.find(c => c.command === 'xcodebuild');
  assert.deepEqual(download.args, ['-downloadPlatform', 'iOS', '-buildVersion', '26.5', '-architectureVariant', 'arm64']);
  assert.equal(download.options.timeout, 900000);
  assert.equal(h.calls.filter(c => c.args[1] === 'list').length, 2);
  assert.equal((await h.record()).downloaded, true);
});

test('a local invocation does not implicitly download a missing runtime', async t => {
  const h = await harness(t, { installed: false });
  await assert.rejects(prepareRuntime(h.input), /runtime .* is unavailable/);
  assert.ok(!h.calls.some(c => c.command === 'xcodebuild'));
  assert.equal((await h.record()).status, 'blocked');
});

test('a reissued Apple build is accepted and recorded after CI installs the pinned OS', async t => {
  const h = await harness(t, { installed: false, build: '23F77' });
  const result = await prepareRuntime({ ...h.input, allowDownload: true });
  assert.equal(result.downloaded, true);
  assert.equal(result.status, 'ready');
  assert.equal(result.version, '26.5');
  assert.equal(result.build, '23F77');
  assert.equal((await h.record()).build, '23F77');
});

test('a different OS version remains blocked before cache preparation', async t => {
  const h = await harness(t, { version: '26.6', build: '23G1' });
  await assert.rejects(prepareRuntime({ ...h.input, allowDownload: true }), /Expected iOS 26.5; found 26.6/);
  assert.ok(!h.calls.some(c => c.command === 'xcodebuild' || c.args.includes('dyld_shared_cache')));
  assert.equal((await h.record()).cachePrepared, false);
});

test('missing build provenance is blocked', async t => {
  const h = await harness(t, { build: '' });
  await assert.rejects(prepareRuntime(h.input), /missing its build metadata/);
  assert.equal((await h.record()).status, 'blocked');
});

test('the older simulator service is rejected before runtime provisioning', async t => {
  const h = await harness(t, { core: '1051.55' });
  await assert.rejects(prepareRuntime(h.input), /CoreSimulator 1174 or newer is required; found 1051.55/);
  assert.equal(h.calls.length, 1);
});

test('download failures are preserved and never reach cache preparation', async t => {
  const h = await harness(t, { installed: false, failDownload: true });
  await assert.rejects(prepareRuntime({ ...h.input, allowDownload: true }), /Runtime download failed/);
  assert.equal((await h.record()).error, 'Runtime download failed');
  assert.ok(!h.calls.some(c => c.args.includes('dyld_shared_cache')));
});

test('a cache preparation timeout remains blocked', async t => {
  const h = await harness(t, { failCache: true });
  await assert.rejects(prepareRuntime(h.input), /cache preparation timed out/);
  assert.equal((await h.record()).status, 'blocked');
  assert.equal((await h.record()).cachePrepared, false);
});
