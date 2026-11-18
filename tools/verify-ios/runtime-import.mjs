import { mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const importedRoot = '/Library/Developer/CoreSimulator/Cryptex/Images/';
const mobileAssetRoot = '/System/Library/AssetsV2/com_apple_MobileAsset_iOSSimulatorRuntime/';
const simctlTimeout = 180000;
const assetReclamationWarning = 'Removed the runtime, but did not reclaim its MobileAsset';
const imageIdentifier = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;

// CI only: MobileAsset runtimes can be re-registered and unmounted while a
// simulator uses them (Apple FB25398296). Clear the duplicate registrations
// before importing a self-contained runtime and booting the test device.
export async function ensureImportedRuntime({ run, evidence, runtime, version }) {
  const runtimeCommand = (args, options = {}) => run('xcrun', ['simctl', 'runtime', ...args],
    { timeout: simctlTimeout, log: `${evidence}/runtime-import.log`, ...options });
  const images = async (timeout = simctlTimeout) => Object.values(JSON.parse((await runtimeCommand(['list', '-j'],
    { timeout, log: `${evidence}/runtime-images.log` })).output));
  const ready = list => list.find(image => image.runtimeIdentifier === runtime && image.version === version
    && image.state === 'Ready' && image.path?.startsWith(importedRoot));
  const duplicates = list => list.filter(image => image.runtimeIdentifier === runtime && image.path?.startsWith(mobileAssetRoot));
  const warnings = [];

  const removeDuplicates = async () => {
    const targets = duplicates(await images());
    let needsRescan = false;
    for (const target of targets) {
      if (target.state === 'Deleting') continue;
      if (!target.deletable || !imageIdentifier.test(target.identifier))
        throw new Error('Superseded target runtime cannot be safely removed');
      const removed = await runtimeCommand(['delete', target.identifier], { allowFailure: true });
      if (removed.timedOut || removed.cancelled)
        throw new Error(`Runtime cleanup ${removed.cancelled ? 'was cancelled' : 'timed out'}`);
      if (removed.code === 0) continue;
      if (removed.code !== 30 || !removed.output.includes(assetReclamationWarning))
        throw new Error(`Runtime cleanup failed (exit ${removed.code}): ${removed.output}`);
      warnings.push(`${assetReclamationWarning} for ${target.identifier} (exit 30)`);
      needsRescan = true;
    }
    if (!targets.length) return needsRescan;

    // Deletion can still be in progress after simctl exits. Confirm the
    // registrations are gone before rescanning or moving on to import.
    const deadline = Date.now() + simctlTimeout;
    let remaining = simctlTimeout;
    while (duplicates(await images(remaining)).length) {
      remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error('Superseded runtime registrations did not finish deleting');
      await delay(Math.min(1000, remaining));
      remaining = Math.max(1, deadline - Date.now());
    }
    return needsRescan;
  };

  const cleanUpMobileAsset = async () => {
    if (await removeDuplicates()) {
      console.log('Rescanning simulator runtimes after the MobileAsset reclamation warning');
      await runtimeCommand(['scan-and-mount']);
      await removeDuplicates();
    }
  };

  const initial = await images();
  const alreadyImported = ready(initial);
  if (!alreadyImported) {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'verify-ios-runtime-export-'));
    try {
      console.log(`Exporting pinned iOS runtime ${version} for stable import`);
      const exported = await run('xcodebuild', ['-downloadPlatform', 'iOS', '-buildVersion', version,
        '-architectureVariant', 'arm64', '-exportPath', directory],
      { timeout: 15 * 60_000, allowFailure: true, log: `${evidence}/runtime-download.log` });
      // Xcode can return EX_SOFTWARE (70) after successfully exporting. Only a
      // complete bundle subsequently accepted by import and simctl is usable.
      if (exported.timedOut || exported.cancelled || ![0, 70].includes(exported.code))
        throw new Error(`Runtime export failed (exit ${exported.code}${exported.timedOut ? ', timed out' : ''})`);
      const bundles = (await readdir(directory, { withFileTypes: true }))
        .filter(entry => entry.isDirectory() && entry.name.endsWith('.exportedBundle'));
      if (bundles.length !== 1) throw new Error('Runtime export did not produce exactly one exported bundle');
      // Export also installs a MobileAsset. Clear it before mounting the
      // imported image so CoreSimulator only has one profile to select.
      await cleanUpMobileAsset();
      console.log(`Importing pinned iOS runtime ${version}`);
      await run('xcodebuild', ['-importPlatform', path.join(directory, bundles[0].name)],
        { timeout: 10 * 60_000, log: `${evidence}/runtime-import.log` });
    } finally {
      // Keep multi-gigabyte exports outside the uploaded evidence and reclaim
      // them before cache preparation and simulator boot.
      await rm(directory, { recursive: true, force: true });
    }
  } else if (duplicates(initial).length) {
    await cleanUpMobileAsset();
  }

  // The rescan can register a fallback image after its command has exited.
  // Remove that late registration without rescanning after import.
  if (!alreadyImported) await removeDuplicates();
  const final = await images();
  const image = ready(final);
  if (!image) throw new Error('Imported runtime is not Ready in CoreSimulator secure storage');
  if (duplicates(final).length) throw new Error('Superseded MobileAsset runtime is still registered after import');
  return { identifier: image.identifier, build: image.build, path: image.path, bundlePath: image.runtimeBundlePath, warnings };
}
