import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { CI_RUNTIME, prepareRuntime } from '../runtime-preparation.mjs';

async function harness(t, { installed = true, core = '1174.9.2', version = CI_RUNTIME.version, build = '23F73',
  failDownload = false, failCache = false, failImport = false, exportExitCode = 0, missingExport = false,
  imported = false, importReady = true, importBuild = build, staleProfile = false } = {}) {
  const evidence = await mkdtemp(path.join(os.tmpdir(), 'runtime-preparation-'));
  t.after(() => rm(evidence, { recursive: true, force: true }));
  const calls = [];
  let mobileAsset = installed;
  const originalId = 'AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA';
  const importedId = 'BBBBBBBB-BBBB-BBBB-BBBB-BBBBBBBBBBBB';
  const run = async (command, args, options) => {
    calls.push({ command, args, options });
    if (command === 'plutil') return { output: core };
    if (command === 'xcodebuild') {
      if (args[0] === '-downloadPlatform') {
        if (failDownload) throw new Error('Runtime download failed');
        if (!missingExport) await mkdir(path.join(args[args.indexOf('-exportPath') + 1], 'iOS.exportedBundle'));
        installed = true; mobileAsset = true;
        return { output: '', code: exportExitCode };
      }
      if (failImport) throw new Error('Runtime import failed');
      imported = true;
      return { output: '', code: 0 };
    }
    if (args[1] === 'list') return { output: JSON.stringify({ runtimes: installed
      ? [{ identifier: CI_RUNTIME.identifier, isAvailable: true, version, buildversion: build,
        bundlePath: imported && !staleProfile ? '/imported-mount/iOS.simruntime' : '/mobile-asset-mount/iOS.simruntime' }] : [] }) };
    if (args[1] === 'runtime' && args[2] === 'list') return { output: JSON.stringify({
      ...(mobileAsset ? { [originalId]: { identifier: originalId, runtimeIdentifier: CI_RUNTIME.identifier, version, build,
        state: 'Ready', path: '/System/Library/AssetsV2/com_apple_MobileAsset_iOSSimulatorRuntime/example.asset/AssetData', deletable: true } } : {}),
      ...(imported ? { [importedId]: { identifier: importedId, runtimeIdentifier: CI_RUNTIME.identifier, version, build: importBuild,
        runtimeBundlePath: '/imported-mount/iOS.simruntime',
        state: importReady ? 'Ready' : 'Unusable', path: '/Library/Developer/CoreSimulator/Cryptex/Images/bundle/imported/Restore/runtime.dmg' } } : {}),
      unrelated: { identifier: 'CCCCCCCC-CCCC-CCCC-CCCC-CCCCCCCCCCCC', runtimeIdentifier: 'unrelated-runtime',
        path: '/System/Library/AssetsV2/com_apple_MobileAsset_iOSSimulatorRuntime/unrelated.asset/AssetData', deletable: true },
    }) };
    if (args[1] === 'runtime' && args[2] === 'delete') { mobileAsset = false; return { output: '', code: 0 }; }
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

test('CI exports and imports the exact OS, then removes only its superseded MobileAsset registration before cache preparation', async t => {
  const h = await harness(t, { installed: false });
  await prepareRuntime({ ...h.input, allowDownload: true });
  const download = h.calls.find(c => c.command === 'xcodebuild');
  assert.deepEqual(download.args.slice(0, 7), ['-downloadPlatform', 'iOS', '-buildVersion', '26.5', '-architectureVariant', 'arm64', '-exportPath']);
  assert.equal(download.options.timeout, 900000);
  assert.equal(download.options.allowFailure, true);
  const imported = h.calls.find(c => c.args[0] === '-importPlatform');
  assert.ok(imported.args[1].endsWith('/iOS.exportedBundle'));
  const removed = h.calls.filter(c => c.args[2] === 'delete');
  assert.equal(removed.length, 1);
  assert.equal(removed[0].args[3], 'AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA');
  assert.ok(h.calls.indexOf(removed[0]) < h.calls.findIndex(c => c.args.includes('dyld_shared_cache')));
  assert.equal(h.calls.filter(c => c.args[1] === 'list').length, 2);
  assert.equal((await h.record()).downloaded, true);
  await assert.rejects(readFile(imported.args[1]), /ENOENT/);
});

test('an already imported CI runtime is reused without exporting or importing again', async t => {
  const h = await harness(t, { imported: true });
  const result = await prepareRuntime({ ...h.input, allowDownload: true });
  assert.equal(result.status, 'ready');
  assert.ok(!h.calls.some(c => c.command === 'xcodebuild'));
  assert.match(result.importedRuntime.path, /CoreSimulator\/Cryptex\/Images/);
});

test('Xcode export exit 70 is usable only when import accepts a complete exported bundle', async t => {
  const h = await harness(t, { installed: false, exportExitCode: 70 });
  assert.equal((await prepareRuntime({ ...h.input, allowDownload: true })).status, 'ready');
  for (const options of [{ missingExport: true }, { failImport: true }, { importReady: false }]) {
    const bad = await harness(t, { installed: false, exportExitCode: 70, ...options });
    await assert.rejects(prepareRuntime({ ...bad.input, allowDownload: true }), /exported bundle|import failed|not Ready/);
    assert.ok(!bad.calls.some(c => c.args.includes('dyld_shared_cache')));
    assert.equal((await bad.record()).status, 'blocked');
  }
});

test('a failed export, mismatched build, or stale profile cannot reach simulator boot', async t => {
  for (const options of [{ exportExitCode: 1 }, { importBuild: 'wrong-build' }, { staleProfile: true }]) {
    const h = await harness(t, { installed: false, ...options });
    await assert.rejects(prepareRuntime({ ...h.input, allowDownload: true }), /export failed|does not match|does not use/);
    assert.ok(!h.calls.some(c => c.args.includes('dyld_shared_cache')));
  }
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
