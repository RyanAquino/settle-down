import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCacheKey, releaseBuildArgs } from '../build-config.mjs';

import { cachedAppName, validateApp } from '../build-artifact.mjs';
import { APP_ID } from '../policy.mjs';

import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const identity = { tree: 'a'.repeat(40), toolingHash: 'b'.repeat(64), xcode: 'Xcode 26.6\nBuild version 17F113', nodeMajor: '22' };
test('binary cache requires exact source, build tooling, and toolchain identity', () => {
  const key = buildCacheKey(identity);
  assert.equal(buildCacheKey({ ...identity }), key);
  for (const change of [ { tree: 'c'.repeat(40) }, { toolingHash: 'c'.repeat(64) }, { xcode: 'Xcode 26.7' }, { nodeMajor: '24' } ]) {
    assert.notEqual(buildCacheKey({ ...identity, ...change }), key);
  }
  assert.throws(() => buildCacheKey({ ...identity, tree: 'HEAD' }));
  assert.throws(() => buildCacheKey({ ...identity, toolingHash: '' }));
});

test('Release compilation explicitly targets only arm64 simulator with timing evidence', () => {
  const args = releaseBuildArgs({ workspace: '/tmp/App.xcworkspace', scheme: 'App', derivedData: '/tmp/derived' });
  assert.equal(args[args.indexOf('-configuration') + 1], 'Release');
  assert.equal(args[args.indexOf('-sdk') + 1], 'iphonesimulator');
  assert.ok(args.includes('ARCHS=arm64'));
  assert.ok(args.includes('ONLY_ACTIVE_ARCH=YES'));
  assert.ok(args.includes('CODE_SIGNING_ALLOWED=NO'));
  assert.ok(args.includes('-showBuildTimingSummary'));
  assert.equal(args.includes('clean'), false);
});

test('archive entries must all belong to a single app without traversal', () => {
  assert.equal(cachedAppName(['SettleDown.app/', 'SettleDown.app/Info.plist']), 'SettleDown.app');
  for (const entries of [[], ['../App.app'], ['/App.app'], ['App.app/../other'], ['App.app/', 'Other.app/file']]) {
    assert.throws(() => cachedAppName(entries));
  }
});

test('fresh and reused apps must have correct identity, OTA isolation, platform, and architecture', async () => {
  const valid = { CFBundleIdentifier: APP_ID, EXUpdatesEnabled: 'false', 'CFBundleSupportedPlatforms:0': 'iPhoneSimulator', CFBundleExecutable: 'SettleDown', archs: 'arm64' };
  const execute = values => async (command, args) => ({ output: command === 'lipo' ? values.archs : values[args[1].slice('Print :'.length)] });
  await validateApp('/tmp/SettleDown.app', execute(valid));
  for (const change of [
    { CFBundleIdentifier: 'other.app' }, { EXUpdatesEnabled: 'true' },
    { 'CFBundleSupportedPlatforms:0': 'iPhoneOS' }, { CFBundleExecutable: '../outside' },
    { archs: 'arm64 x86_64' }, { archs: 'x86_64' },
  ]) await assert.rejects(validateApp('/tmp/SettleDown.app', execute({ ...valid, ...change })));
});

test('a mismatched cached manifest fails before extraction and records failed validation', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'ios-build-cache-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(`${directory}/cache`);
  await writeFile(`${directory}/cache/manifest.json`, JSON.stringify({ key: 'wrong-build' }));
  const build = new URL('../build.mjs', import.meta.url);
  await assert.rejects(promisify(execFile)(process.execPath, [build.pathname, directory, directory, '--validate-only'], {
    env: { ...process.env, VERIFY_BUILD_KEY: 'expected-build', GITHUB_STEP_SUMMARY: `${directory}/summary.md` },
  }), /Cached build identity mismatch/);
  const timings = JSON.parse(await readFile(`${directory}/timings.json`, 'utf8'));
  assert.equal(timings.length, 1);
  assert.equal(timings[0].stage, 'cached binary validation');
  assert.equal(timings[0].status, 'failure');
  assert.match(await readFile(`${directory}/summary.md`, 'utf8'), /cached binary validation/);
});
