import { mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const importedRoot = '/Library/Developer/CoreSimulator/Cryptex/Images/';
const mobileAssetRoot = '/System/Library/AssetsV2/com_apple_MobileAsset_iOSSimulatorRuntime/';
const isImported = image => image.path?.startsWith(importedRoot);

// CI only: MobileAsset runtimes can be re-registered and unmounted while a
// simulator uses them (Apple FB25398296). Import a self-contained bundle before
// booting any device, then remove only this target's superseded MobileAsset copy.
export async function ensureImportedRuntime({ run, evidence, runtime, version }) {
  const images = async () => Object.values(JSON.parse((await run('xcrun', ['simctl', 'runtime', 'list', '-j'],
    { timeout: 180000, log: `${evidence}/runtime-images.log` })).output));
  const ready = list => list.find(image => image.runtimeIdentifier === runtime && image.version === version
    && image.state === 'Ready' && isImported(image));
  let image = ready(await images());
  if (!image) {
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
      console.log(`Importing pinned iOS runtime ${version}`);
      await run('xcodebuild', ['-importPlatform', path.join(directory, bundles[0].name)],
        { timeout: 10 * 60_000, log: `${evidence}/runtime-import.log` });
      image = ready(await images());
      if (!image) throw new Error('Imported runtime is not Ready in CoreSimulator secure storage');
    } finally {
      // Keep multi-gigabyte exports outside the uploaded evidence and reclaim
      // them before cache preparation and simulator boot.
      await rm(directory, { recursive: true, force: true });
    }
  }
  for (const duplicate of await images()) {
    if (duplicate.runtimeIdentifier !== runtime || !duplicate.path?.startsWith(mobileAssetRoot)) continue;
    if (!duplicate.deletable || !/^[A-F0-9-]{36}$/i.test(duplicate.identifier))
      throw new Error('Superseded target runtime cannot be safely removed');
    await run('xcrun', ['simctl', 'runtime', 'delete', duplicate.identifier],
      { timeout: 180000, log: `${evidence}/runtime-import.log` });
  }
  const final = await images();
  image = ready(final);
  if (!image || final.some(item => item.runtimeIdentifier === runtime && item.path?.startsWith(mobileAssetRoot)))
    throw new Error('Runtime import did not leave a stable imported target');
  return { identifier: image.identifier, build: image.build, path: image.path, bundlePath: image.runtimeBundlePath };
}
