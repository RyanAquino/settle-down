import { FIXTURE_ORIGIN } from './fixture-control.mjs';
import { mkdir, readdir, writeFile, readFile, cp } from 'node:fs/promises';
import path from 'node:path';
import { APP_ID } from './policy.mjs';
import { cleanEnv, run } from './process.mjs';
import { BUILD_ARCH, releaseBuildArgs } from './build-config.mjs';
import { cachedAppName, validateApp } from './build-artifact.mjs';

const source = path.resolve(process.argv[2]);
const output = path.resolve(process.argv[3]);
const validateOnly = process.argv.includes('--validate-only');
await mkdir(output, { recursive: true });
const env = {
  ...cleanEnv(),
  CI: '1',
  CI_E2E: '1',
  EXPO_NO_DOTENV: '1',
  USE_CCACHE: '1',
  EXPO_PUBLIC_API_BASE_URL: FIXTURE_ORIGIN,
  EXPO_PUBLIC_AUTH_TOKEN: '',
  EXPO_PUBLIC_SHOW_DEBUG_SKIP_BUTTON: 'false',
};
const timings = [];
async function stage(name, action) {
  const started = Date.now();
  console.log(`Starting ${name}`);
  let status = 'failure';
  try {
    const value = await action();
    status = 'success';
    return value;
  } finally {
    const seconds = Math.round((Date.now() - started) / 100) / 10;
    timings.push({ stage: name, seconds, status });
    console.log(`${name}: ${status} (${seconds}s)`);
    await writeFile(`${output}/timings.json`, JSON.stringify(timings, null, 2));
  }
}
const execute = (command, args, options = {}) =>
  run(command, args, { cwd: source, env, ...options });

try {
  if (validateOnly) {
    await stage('cached binary validation', async () => {
      const manifest = JSON.parse(await readFile(`${output}/cache/manifest.json`, 'utf8'));
      if (!process.env.VERIFY_BUILD_KEY || manifest.key !== process.env.VERIFY_BUILD_KEY)
        throw new Error('Cached build identity mismatch');
      const entries = (await execute('tar', ['-tzf', `${output}/cache/app.tar.gz`])).output
        .trim()
        .split('\n');
      const appName = cachedAppName(entries);
      const extracted = `${output}/cached-app`;
      await mkdir(extracted, { recursive: true });
      await execute('tar', ['-xzf', `${output}/cache/app.tar.gz`, '-C', extracted]);
      await validateApp(`${extracted}/${appName}`, execute);
    });
  } else {
    await stage('npm dependencies', () =>
      execute('npm', ['ci'], { timeout: 15 * 60_000, log: `${output}/dependencies.log` }),
    );
    const expo = path.join(source, 'node_modules/.bin/expo');
    await stage('Expo configuration', async () => {
      const config = JSON.parse((await execute(expo, ['config', '--json'])).output);
      if (config.ios?.bundleIdentifier !== APP_ID || config.updates?.enabled !== false)
        throw new Error(
          'The PR must include CI_E2E configuration with the expected bundle ID and updates disabled.',
        );
      await writeFile(`${output}/expo-config.json`, JSON.stringify(config, null, 2));
    });
    await stage('Expo prebuild', () =>
      execute(expo, ['prebuild', '--platform', 'ios', '--no-install'], {
        timeout: 10 * 60_000,
        log: `${output}/prebuild.log`,
      }),
    );
    await stage('CocoaPods', () =>
      execute('pod', ['install'], {
        cwd: `${source}/ios`,
        timeout: 15 * 60_000,
        log: `${output}/pods.log`,
      }),
    );
    const workspaces = (await readdir(`${source}/ios`)).filter((name) =>
      name.endsWith('.xcworkspace'),
    );
    if (workspaces.length !== 1) throw new Error('Expected one generated iOS workspace');
    const scheme = path.basename(workspaces[0], '.xcworkspace');
    const derivedData = `${output}/derived-data`;
    await stage('Release compilation', () =>
      execute(
        'xcodebuild',
        releaseBuildArgs({ workspace: `${source}/ios/${workspaces[0]}`, scheme, derivedData }),
        { timeout: 50 * 60_000, log: `${output}/build.log` },
      ),
    );
    const products = `${derivedData}/Build/Products/Release-iphonesimulator`;
    const apps = (await readdir(products)).filter((name) => name.endsWith('.app'));
    if (apps.length !== 1) throw new Error('Expected exactly one simulator .app');
    const app = `${products}/${apps[0]}`;
    await stage('binary validation', () => validateApp(app, execute));
    await stage('app packaging', async () => {
      await mkdir(`${output}/cache`, { recursive: true });
      await execute('tar', ['-czf', `${output}/cache/app.tar.gz`, '-C', products, apps[0]]);
      await writeFile(
        `${output}/cache/manifest.json`,
        JSON.stringify({ key: process.env.VERIFY_BUILD_KEY, arch: BUILD_ARCH }),
      );
    });
    await execute('ccache', ['--show-stats'], { log: `${output}/ccache.log`, allowFailure: true });
  }
  await cp(`${output}/cache/app.tar.gz`, `${output}/app.tar.gz`);
} finally {
  if (process.env.GITHUB_STEP_SUMMARY) {
    const { appendFile } = await import('node:fs/promises');
    await appendFile(
      process.env.GITHUB_STEP_SUMMARY,
      `### iOS build timings\n\n| Stage | Seconds | Result |\n| --- | ---: | --- |\n${timings.map((t) => `| ${t.stage} | ${t.seconds} | ${t.status} |`).join('\n')}\n`,
    );
  }
}
