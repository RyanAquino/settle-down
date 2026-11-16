import { FIXTURE_ORIGIN } from './fixture-control.mjs';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { APP_ID } from './policy.mjs';
import { cleanEnv, run } from './process.mjs';

const source = path.resolve(process.argv[2]);
const output = path.resolve(process.argv[3]);
await mkdir(output, { recursive: true });
const env = { ...cleanEnv(), CI: '1', CI_E2E: '1', EXPO_NO_DOTENV: '1',
  EXPO_PUBLIC_API_BASE_URL: FIXTURE_ORIGIN, EXPO_PUBLIC_AUTH_TOKEN: '',
  EXPO_PUBLIC_SHOW_DEBUG_SKIP_BUTTON: 'false' };
await run('npm', ['ci'], { cwd: source, env, timeout: 15 * 60_000, log: `${output}/dependencies.log` });
const expo = path.join(source, 'node_modules/.bin/expo');
const config = JSON.parse((await run(expo, ['config', '--json'], { cwd: source, env })).output);
if (config.ios?.bundleIdentifier !== APP_ID || config.updates?.enabled !== false) {
  throw new Error('The PR must include CI_E2E configuration with the expected bundle ID and updates disabled. Rebase onto the CI setup commit.');
}
await writeFile(`${output}/expo-config.json`, JSON.stringify(config, null, 2));
await run(expo, ['run:ios', '--configuration', 'Release', '--device', 'generic', '--no-bundler', '--output', `${output}/binary`],
  { cwd: source, env, timeout: 50 * 60_000, log: `${output}/build.log` });
const apps = (await readdir(`${output}/binary`)).filter(f => f.endsWith('.app'));
if (apps.length !== 1) throw new Error('Expected exactly one simulator .app');
const app = path.join(output, 'binary', apps[0]);
await run('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleIdentifier', `${app}/Info.plist`]).then(r => {
  if (r.output.trim() !== APP_ID) throw new Error('Built app bundle ID mismatch');
});
const updates = await run('/usr/libexec/PlistBuddy', ['-c', 'Print :EXUpdatesEnabled', `${app}/Expo.plist`]);
if (updates.output.trim() !== 'false') throw new Error('Built app may load OTA updates');
await run('tar', ['-czf', `${output}/app.tar.gz`, '-C', `${output}/binary`, apps[0]]);
