import test from 'node:test';
import assert from 'node:assert/strict';
import { validateFlow, validatePlan, verdict, APP_ID, MANUAL_CHECKS, resultSchema } from '../policy.mjs';
import { checkJUnit } from '../runner.mjs';

const flow = commands => `appId: \${APP_ID}\n---\n${commands}\n`;
const valid = flow('- launchApp\n- tapOn: Library\n- assertVisible: "Expected change"\n- takeScreenshot: result');
test('literal UI flows and stable selectors are accepted', () => {
  assert.equal(validateFlow(valid, { replay: true }).steps.length, 4);
  assert.doesNotThrow(() => validateFlow(flow('- tapOn:\n    id: item-cost-1\n    index: 0')));
  assert.doesNotThrow(() => validateFlow(flow('- launchApp:\n    permissions:\n      all: allow')));
});
for (const [name, yaml] of Object.entries({
  script: flow('- runScript: evil.js'), nested: flow('- runFlow:\n    commands:\n      - evalScript: "bad"'),
  headerHook: `appId: ${APP_ID}\nonFlowStart:\n  - runScript: bad.js\n---\n- launchApp`,
  expression: flow('- tapOn:\n    text: "${http.get(\'https://example.com\')}"'),
  optionalAssertion: flow('- assertVisible:\n    text: Nope\n    optional: true'),
  pathTraversal: flow('- takeScreenshot: ../../escape'),
  unsafeHeader: 'appId: com.apple.mobilesafari\n---\n- launchApp',
  alternateApp: flow('- launchApp:\n    appId: com.apple.mobilesafari'),
  alias: flow('- tapOn: &target Library\n- assertVisible: *target'),
  tag: flow('- tapOn: !!str Library'),
  duplicateKey: 'appId: x\nappId: ${APP_ID}\n---\n- launchApp',
  multiCommand: flow('- tapOn: Library\n  assertVisible: Library'),
  environment: `appId: ${APP_ID}\nenv:\n  FOO: bar\n---\n- launchApp`,
  thirdDocument: `${valid}\n---\n- launchApp`,
  unknownOption: flow('- tapOn:\n    text: Library\n    retryTapIfNoChange: true'),
  prototype: flow('- constructor: null'),
})) test(`rejects ${name}`, () => assert.throws(() => validateFlow(yaml)));
test('replay requires launch, visible assertions, and evidence', () => {
  for (const yaml of [flow('- launchApp'), flow('- assertVisible: Hi\n- takeScreenshot: a'), flow('- launchApp\n- assertVisible: Hi')]) {
    assert.throws(() => validateFlow(yaml, { replay: true }));
  }
});
test('plans cannot silently contain no tests or duplicate scenario IDs', () => {
  const plan = { disposition: 'ready', rationale: 'Tests the changed receipt validation.', limitations: [], scenarios: [] };
  assert.throws(() => validatePlan(plan));
  const scenario = { id: 'receipt', name: 'Receipt', coverage: 'New validation', fixture: 'success', yaml: valid };
  assert.equal(validatePlan({ ...plan, scenarios: [scenario] }).scenarios.length, 1);
  assert.throws(() => validatePlan({ ...plan, scenarios: [scenario, scenario] }));
  assert.throws(() => validatePlan({ ...plan, scenarios: [{ ...scenario, fixture: 'production' }] }));
});
test('physical-device-only gaps never block, and blocked plans need a simulator-side limitation', () => {
  const scenario = {
    id: 'zoom',
    name: 'Zoom',
    coverage: 'Zoom controls enable and reset',
    fixture: 'success',
    yaml: valid,
  };
  const base = { rationale: 'Covers the simulator-observable zoom controls.', scenarios: [] };
  const deviceOnly = ['Actual preview magnification needs a physical camera.'];
  assert.deepEqual(
    validatePlan({ ...base, disposition: 'ready', limitations: [], scenarios: [scenario] })
      .deviceOnly,
    [],
  );
  assert.deepEqual(
    validatePlan({
      ...base,
      disposition: 'ready',
      limitations: [],
      deviceOnly,
      scenarios: [scenario],
    }).deviceOnly,
    deviceOnly,
  );
  assert.equal(
    validatePlan({ ...base, disposition: 'skipped', limitations: [], deviceOnly }).disposition,
    'skipped',
  );
  // A device-only gap alone cannot produce BLOCKED.
  assert.throws(
    () => validatePlan({ ...base, disposition: 'blocked', limitations: [], deviceOnly }),
    /deviceOnly/,
  );
  // Blocking limitations must use the blocked disposition.
  assert.throws(
    () =>
      validatePlan({
        ...base,
        disposition: 'ready',
        limitations: ['Source could not be read'],
        scenarios: [scenario],
      }),
    /submit blocked/,
  );
  assert.throws(() =>
    validatePlan({ ...base, disposition: 'skipped', limitations: ['Tool failed'] }),
  );
  assert.equal(
    validatePlan({ ...base, disposition: 'blocked', limitations: ['Tool failed'] }).disposition,
    'blocked',
  );
});
test('verdicts require executed, nonempty, complete evidence', () => {
  const result = { agentCompleted: true, disposition: 'ready', limitations: [], scenarios: [{ status: 'PASS', exitCode: 0, junitVerified: true }] };
  assert.equal(verdict(result), 'PASS');
  assert.equal(verdict({ ...result, deviceOnly: ['Camera orientation needs an iPhone'] }), 'PASS');
  assert.equal(
    verdict({ ...result, disposition: 'skipped', scenarios: [], deviceOnly: ['Autofocus'] }),
    'SKIPPED',
  );
  assert.equal(verdict({ ...result, scenarios: [] }), 'BLOCKED');
  assert.equal(verdict({ ...result, agentCompleted: false }), 'BLOCKED');
  assert.equal(verdict({ ...result, limitations: ['Physical camera is required'] }), 'BLOCKED');
  assert.equal(verdict({ ...result, disposition: 'skipped', scenarios: [] }), 'SKIPPED');
  assert.equal(verdict({ ...result, scenarios: [{ status: 'PASS', exitCode: 0 }] }), 'BLOCKED');
  assert.equal(verdict({ ...result, scenarios: [{ status: 'FAIL' }] }, 'failure'), 'FAIL');
  assert.equal(verdict(result, 'failure'), 'BLOCKED');
  assert.equal(verdict(result, 'cancelled'), 'CANCELLED');
  assert.equal(verdict(undefined), 'BLOCKED');
});
test('JUnit rejects missing, malformed, skipped, and failed execution', () => {
  assert.equal(checkJUnit('<testsuites><testsuite tests="1" failures="0"><testcase name="change"/></testsuite></testsuites>'), true);
  for (const xml of ['', '<broken>', '<testsuite tests="0"/>',
    '<testsuite><testcase name="x"><skipped/></testcase></testsuite>',
    '<testsuite><testcase name="x"><failure message="no"/></testcase></testsuite>',
    '<testsuite failures="1"><testcase name="x"/></testsuite>',
    '<!DOCTYPE x [<!ENTITY y SYSTEM "file:///etc/passwd">]><testsuite><testcase name="x"/></testsuite>',
  ]) assert.equal(checkJUnit(xml), false, xml);
});

test('background and resume are allowed without exposing other system keys', () => {
  assert.doesNotThrow(() =>
    validateFlow(
      flow(
        '- launchApp\n- pressKey: Home\n- launchApp:\n    stopApp: false\n- assertVisible: Camera\n- takeScreenshot: resumed',
      ),
      { replay: true },
    ),
  );
  for (const key of ['Power', 'Lock', '${evil}', 'Enter']) {
    assert.throws(() => validateFlow(flow(`- pressKey: "${key}"`)));
  }
});

test('only explicit harness exclusions can be recorded as manual checks', () => {
  const plan = {
    disposition: 'ready',
    rationale: 'Zoom controls and lifecycle replayed.',
    limitations: [],
    manualChecks: MANUAL_CHECKS,
    scenarios: [
      {
        id: 'zoom',
        name: 'Zoom',
        coverage: 'Controls and lifecycle',
        fixture: 'success',
        yaml: valid,
      },
    ],
  };
  assert.deepEqual(validatePlan(plan).manualChecks, MANUAL_CHECKS);
  for (const gap of ['Background reset untested', 'Tool failed', 'Zoom button did not work']) {
    assert.throws(() => validatePlan({ ...plan, manualChecks: [gap] }));
  }
  const result = {
    version: 1,
    headSha: 'a'.repeat(40),
    agentCompleted: true,
    disposition: 'ready',
    limitations: [],
    manualChecks: MANUAL_CHECKS,
    verdict: 'PASS',
    scenarios: [
      {
        id: 'zoom',
        name: 'Zoom',
        coverage: 'Controls',
        fixture: 'success',
        status: 'PASS',
        exitCode: 0,
        junitVerified: true,
      },
    ],
  };
  assert.deepEqual(resultSchema.parse(result).manualChecks, MANUAL_CHECKS);
  assert.equal(verdict(result), 'PASS');
  assert.equal(verdict({ ...result, limitations: ['Lifecycle untested'] }), 'BLOCKED');
  assert.equal(verdict({ ...result, scenarios: [{ status: 'FAIL' }] }), 'FAIL');
  assert.equal(verdict({ ...result, scenarios: [] }), 'BLOCKED');
  assert.equal(verdict(result, 'failure'), 'BLOCKED');
});


test('camera permission denial and recovery are replayable for the app under test', () => {
  const yaml = flow(`- launchApp:
    permissions:
      all: allow
      camera: deny
- assertVisible: Open settings
- tapOn: Open settings
- pressKey: Home
- setPermissions:
    permissions:
      camera: allow
- launchApp:
    stopApp: false
    permissions:
      camera: allow
- assertVisible: Capture receipt
- takeScreenshot: permission-recovered`);
  assert.doesNotThrow(() => validateFlow(yaml, { replay: true }));
  for (const camera of ['allow', 'deny']) {
    assert.doesNotThrow(() => validateFlow(flow(`- setPermissions:\n    permissions:\n      camera: ${camera}`)));
  }
});

for (const [name, steps] of Object.entries({
  alternatePermissionApp: '- setPermissions:\n    appId: com.apple.mobilesafari\n    permissions:\n      camera: allow',
  unrelatedPermission: '- setPermissions:\n    permissions:\n      location: allow',
  allRuntimePermissions: '- setPermissions:\n    permissions:\n      all: allow',
  emptyPermissions: '- setPermissions:\n    permissions: {}',
  emptyLaunchPermissions: '- launchApp:\n    permissions: {}',
  invalidPermission: '- setPermissions:\n    permissions:\n      camera: arbitrary',
  executablePermission: '- setPermissions:\n    permissions:\n      camera: "${evil}"',
  unknownLaunchPermission: '- launchApp:\n    permissions:\n      camera: deny\n      location: allow',
})) test(`rejects ${name}`, () => assert.throws(() => validateFlow(flow(steps))));
