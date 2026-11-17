import { writeFile } from 'node:fs/promises';

export const CI_RUNTIME = Object.freeze({
  identifier: 'com.apple.CoreSimulator.SimRuntime.iOS-26-5',
  version: '26.5',
});

export async function prepareRuntime({ run, evidence, runtime = CI_RUNTIME.identifier, allowDownload = false }) {
  const record = { identifier: runtime, status: 'preparing', downloaded: false, cachePrepared: false };
  try {
    const core = (await run('plutil', ['-extract', 'CFBundleVersion', 'raw', '-o', '-',
      '/Library/Developer/PrivateFrameworks/CoreSimulator.framework/Resources/Info.plist'], { timeout: 15000 })).output.trim();
    record.coreSimulator = core;
    if (!/^\d+(\.\d+)*$/.test(core) || Number.parseInt(core, 10) < 1174) {
      throw new Error(`CoreSimulator 1174 or newer is required; found ${core || 'unknown'}`);
    }
    const list = async () => JSON.parse((await run('xcrun', ['simctl', 'list', 'runtimes', '-j'],
      { timeout: 180000, log: `${evidence}/runtime-list.log` })).output).runtimes;
    let installed = (await list()).find(r => r.identifier === runtime && r.isAvailable);
    if (!installed && allowDownload && runtime === CI_RUNTIME.identifier) {
      console.log(`Installing pinned iOS runtime ${CI_RUNTIME.version}`);
      await run('xcodebuild', ['-downloadPlatform', 'iOS', '-buildVersion', CI_RUNTIME.version, '-architectureVariant', 'arm64'],
        { timeout: 15 * 60_000, log: `${evidence}/runtime-download.log` });
      record.downloaded = true;
      installed = (await list()).find(r => r.identifier === runtime && r.isAvailable);
    }
    if (!installed) throw new Error(`Required simulator runtime ${runtime} is unavailable`);
    record.version = installed.version;
    record.build = installed.buildversion;
    if (runtime === CI_RUNTIME.identifier && installed.version !== CI_RUNTIME.version) {
      throw new Error(`Expected iOS ${CI_RUNTIME.version}; found ${installed.version} (${installed.buildversion})`);
    }
    // Apple's version-based installer can return a reissued build of the same OS.
    // Preserve that build as provenance instead of rejecting a valid OS version.
    if (typeof installed.buildversion !== 'string' || !installed.buildversion.trim()) {
      throw new Error(`Runtime ${runtime} is missing its build metadata`);
    }
    console.log(`Preparing shared cache for simulator runtime ${runtime}`);
    await run('xcrun', ['simctl', 'runtime', 'dyld_shared_cache', 'update', runtime],
      { timeout: 10 * 60_000, log: `${evidence}/runtime-cache.log` });
    record.cachePrepared = true;
    record.status = 'ready';
    console.log(`Simulator runtime ready: ${installed.version} (${installed.buildversion}), CoreSimulator ${core}`);
    return record;
  } catch (error) {
    record.status = 'blocked';
    record.error = error.message;
    throw error;
  } finally {
    await writeFile(`${evidence}/runtime-preparation.json`, JSON.stringify(record, null, 2));
  }
}
