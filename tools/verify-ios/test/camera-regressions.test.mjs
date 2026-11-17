import test from 'node:test';
import assert from 'node:assert/strict';
import { cameraRegressions, cameraRegressionsApply , runCameraRegressions } from '../camera-regressions.mjs';
import { validateFlow } from '../policy.mjs';
import { requireScenarioEvidence } from '../exploration.mjs';

import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('required camera flows cover both zoom bounds and the actual native permission switch', () => {
  assert.equal(cameraRegressionsApply(['app/camera.tsx']), true);
  assert.equal(cameraRegressionsApply(['components/camera-session.tsx']), true);
  assert.equal(cameraRegressionsApply(['README.md']), false);
  for (const scenario of cameraRegressions) assert.doesNotThrow(() => validateFlow(scenario.yaml, { replay: true }));
  assert.equal((cameraRegressions[0].yaml.match(/tapOn: Zoom in/g) || []).length, 21);
  assert.match(cameraRegressions[0].yaml, /text: Zoom in\n    enabled: false/);
  assert.match(cameraRegressions[1].yaml, /checked: false\n    point: "90%,50%"/);
  assert.match(cameraRegressions[1].yaml, /checked: true/);
  assert.doesNotMatch(cameraRegressions[1].yaml, /setPermissions:/);
});

test('verified required flows can be reused, but none may be omitted, failed, or rewritten', () => {
  const records = cameraRegressions.map(scenario => ({ scenario, status: 'PASS', exitCode: 0, junitVerified: true }));
  const plan = { disposition: 'ready', scenarios: cameraRegressions };
  assert.doesNotThrow(() => requireScenarioEvidence(plan, [], records));
  assert.throws(() => requireScenarioEvidence({ ...plan, scenarios: [cameraRegressions[0]] }, [], records), /include required regression/);
  assert.throws(() => requireScenarioEvidence(plan, [], [{ ...records[0], status: 'FAIL' }, records[1]]), /required camera regression failed/);
  assert.throws(() => requireScenarioEvidence(plan, [], [{ ...records[0], junitVerified: false }, records[1]]));
  assert.throws(() => requireScenarioEvidence({ ...plan, disposition: 'skipped', scenarios: [] }, [], records), /cannot be skipped/);
  assert.doesNotThrow(() => requireScenarioEvidence({ ...plan, disposition: 'blocked' }, [], records));
});

test('host regression status requires real successful JUnit evidence, not just a zero exit', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'camera-regression-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const resets = [];
  const records = await runCameraRegressions({
    udid: 'synthetic-device', appPath: '/synthetic/app', evidence: directory, token: 'synthetic',
    resetScenario: async input => { resets.push(input); },
    run: async (_command, args) => {
      const output = args[args.indexOf('--output') + 1];
      await writeFile(output, output.includes('zoom-bounds') ? '<passed/>' : '<failed/>');
      return { code: 0 };
    },
    checkJUnit: xml => xml === '<passed/>',
  });
  assert.equal(resets.length, 2);
  assert.equal(records[0].status, 'PASS');
  assert.equal(records[1].status, 'FAIL');
  assert.equal(records[1].junitVerified, false);
  assert.equal(JSON.parse(await readFile(`${directory}/regressions.json`, 'utf8')).length, 2);
});

test('only the first regression can reuse the explicitly untouched initial installation', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'camera-initial-install-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const resets = [], fixtureResets = [];
  await runCameraRegressions({ udid: 'synthetic', appPath: '/synthetic', evidence: directory, token: 'synthetic', initialResetReady: true,
    resetFixture: async (route, options) => { fixtureResets.push({ route, options }); },
    resetScenario: async options => { resets.push(options); },
    run: async (_command, args) => { await writeFile(args[args.indexOf('--output') + 1], '<passed/>'); return { code: 0 }; },
    checkJUnit: () => true,
  });
  assert.equal(fixtureResets.length, 1);
  assert.equal(fixtureResets[0].route, '/__reset');
  assert.equal(fixtureResets[0].options.body.phase, cameraRegressions[0].id);
  assert.equal(resets.length, 1);
  assert.equal(resets[0].phase, cameraRegressions[1].id);
});
