import path from 'node:path';
import { BUILD_ARCH } from './build-config.mjs';
import { APP_ID } from './policy.mjs';

export function cachedAppName(entries) {
  const name = entries[0]?.split('/')[0];
  if (!/^[a-zA-Z0-9_-]+\.app$/.test(name) || entries.some(entry => entry.startsWith('/') || entry.split('/').includes('..') || entry.split('/')[0] !== name)) throw new Error('Invalid cached archive paths');
  return name;
}

export async function validateApp(app, execute) {
  const plist = async (file, key) => (await execute('/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, `${app}/${file}`])).output.trim();
  if (await plist('Info.plist', 'CFBundleIdentifier') !== APP_ID) throw new Error('Built app bundle ID mismatch');
  if (await plist('Expo.plist', 'EXUpdatesEnabled') !== 'false') throw new Error('Built app may load OTA updates');
  if (await plist('Info.plist', 'CFBundleSupportedPlatforms:0') !== 'iPhoneSimulator') throw new Error('Built app is not for the iOS simulator');
  const executable = await plist('Info.plist', 'CFBundleExecutable');
  if (!executable || path.basename(executable) !== executable) throw new Error('Invalid app executable');
  const archs = (await execute('lipo', ['-archs', `${app}/${executable}`])).output.trim();
  if (archs !== BUILD_ARCH) throw new Error(`Expected ${BUILD_ARCH} app, found ${archs}`);
}
