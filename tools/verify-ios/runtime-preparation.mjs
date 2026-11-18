import { writeFile } from 'node:fs/promises';
import { ensureImportedRuntime } from './runtime-import.mjs';

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
    const validate = value => {
      if (runtime === CI_RUNTIME.identifier && value.version !== CI_RUNTIME.version)
        throw new Error(`Expected iOS ${CI_RUNTIME.version}; found ${value.version} (${value.buildversion})`);
      if (typeof value.buildversion !== 'string' || !value.buildversion.trim())
        throw new Error(`Runtime ${runtime} is missing its build metadata`);
    };
    const selectedRuntime = async () => (await list()).find(r => r.identifier === runtime && r.isAvailable);
    let installed = await selectedRuntime();
    if (installed) validate(installed);
    if (allowDownload && runtime === CI_RUNTIME.identifier) {
      record.importedRuntime = await ensureImportedRuntime({ run, evidence, runtime, version: CI_RUNTIME.version });
      record.downloaded = !installed;
      installed = await selectedRuntime();
      if (!installed || installed.bundlePath !== record.importedRuntime.bundlePath) {
        // The disk image can be Ready while the per-user service still holds
        // the profile removed during duplicate cleanup. Reload before booting.
        console.log('Reloading CoreSimulator after the selected runtime profile changed');
        await run('launchctl', ['kill', 'SIGTERM', `user/${process.getuid()}/com.apple.CoreSimulator.CoreSimulatorService`],
          { timeout: 15000, log: `${evidence}/runtime-import.log` });
        record.profileReloaded = true;
        installed = await selectedRuntime();
      }
    }
    if (!installed) throw new Error(`Required simulator runtime ${runtime} is unavailable`);
    validate(installed);
    record.version = installed.version;
    record.build = installed.buildversion;
    // Apple's version-based installer can return a reissued build of the same OS.
    // Preserve that build as provenance instead of rejecting a valid OS version.
    if (record.importedRuntime && installed.buildversion !== record.importedRuntime.build)
      throw new Error('Selected simulator build does not match the imported runtime');
    if (record.importedRuntime && (!record.importedRuntime.bundlePath || installed.bundlePath !== record.importedRuntime.bundlePath))
      throw new Error('Selected simulator profile does not use the imported runtime');
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
