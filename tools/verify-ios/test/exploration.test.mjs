import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ExplorationBudget,
  ScenarioEvidence,
  scenarioFingerprint,
  requireScenarioEvidence,
  EXPLORATION_MS,
  FINALIZE_MS,
  agentFailureMessage,
} from '../exploration.mjs';

const yaml =
  'appId: ${APP_ID}\nname: Test\n---\n- launchApp\n- tapOn: Camera\n- assertVisible: Ready\n- takeScreenshot: ready\n';
const scenario = { id: 'camera', fixture: 'success', yaml };
const plan = { disposition: 'ready', scenarios: [scenario] };
const reset = { tool: 'reset_scenario', ok: true, args: { fixture: 'success' } };
const passed = {
  tool: 'execute_flow',
  ok: true,
  args: { yaml },
  scenarioEvidence: scenarioFingerprint('success', yaml),
};

test('tools share the runner deadline and reserve time/calls for final submission', () => {
  let now = 0;
  const budget = new ExplorationBudget({ deadline: EXPLORATION_MS, now: () => now });
  budget.enter('get_context');
  assert.equal(budget.snapshot().secondsRemaining, 1500);
  now = EXPLORATION_MS - FINALIZE_MS - 89_000;
  assert.throws(() => budget.enter('reset_scenario'), /reserve time/);
  assert.equal(budget.snapshot().phase, 'finalize');
  assert.throws(() => budget.enter('read_source'), /Submit/);
  assert.doesNotThrow(() => budget.enter('submit_plan'));
  now = EXPLORATION_MS + 1;
  assert.equal(budget.snapshot().secondsRemaining, 0);
  assert.doesNotThrow(() => budget.enter('submit_plan'));
});

test('call exhaustion still permits submitting a blocked plan', () => {
  const budget = new ExplorationBudget();
  for (let i = 0; i < 89; i++) budget.enter('get_context');
  assert.throws(() => budget.enter('get_context'), /finalization/);
  for (let i = 0; i < 12; i++) budget.enter('submit_plan');
  assert.equal(budget.snapshot().callsRemaining, 0);
});

test('complete flows can run longer than screen inspection while preserving finalization time', () => {
  let now = 0;
  const budget = new ExplorationBudget({ deadline: EXPLORATION_MS, now: () => now });
  assert.equal(budget.maestroTimeout('run', true), 360_000);
  assert.equal(budget.maestroTimeout('run', false), 360_000);
  assert.equal(budget.maestroTimeout('inspect_screen', true), 300_000);
  assert.equal(budget.maestroTimeout('inspect_screen', false), 180_000);
  now = EXPLORATION_MS - FINALIZE_MS - 150000;
  assert.equal(budget.maestroTimeout('run', false), 150000);
  now += 150000;
  assert.throws(() => budget.maestroTimeout('run', false), /reserve time/);
  assert.doesNotThrow(() => budget.enter('submit_plan'));
});

test('only the first complete successful flow after a successful reset earns evidence', () => {
  const evidence = new ScenarioEvidence();
  assert.equal(evidence.completed(evidence.beginFlow(), yaml, true), undefined);
  evidence.resetStarted();
  evidence.resetCompleted('success');
  const fixture = evidence.beginFlow();
  assert.equal(evidence.completed(fixture, yaml, false), undefined);
  assert.equal(evidence.completed(evidence.beginFlow(), yaml, true), undefined);
  evidence.resetCompleted('success');
  assert.equal(evidence.completed(evidence.beginFlow(), yaml, true), passed.scenarioEvidence);
  evidence.resetCompleted('success');
  evidence.resetStarted();
  assert.equal(evidence.beginFlow(), undefined);
});

test('ready plans cannot assemble fragments or change fixtures/assertions after execution', () => {
  const inspected = { tool: 'inspect_screen', ok: true };
  assert.doesNotThrow(() => requireScenarioEvidence(plan, [reset, passed, inspected]));
  for (const journal of [
    [],
    [reset],
    [passed],
    [reset, { ...passed, scenarioEvidence: undefined }],
    [reset, passed, { ...passed, ok: false }],
  ])
    assert.throws(() => requireScenarioEvidence(plan, [inspected, ...journal]), /complete flow/);
  for (const change of [
    { fixture: 'upload-error' },
    { yaml: yaml.replace('Ready', 'Other') },
    { yaml: yaml.replace('- tapOn: Camera', '- tapOn: Camera\n- tapOn: Settings') },
  ]) {
    assert.throws(() =>
      requireScenarioEvidence({ ...plan, scenarios: [{ ...scenario, ...change }] }, [
        inspected,
        reset,
        passed,
      ]),
    );
  }
  assert.equal(
    scenarioFingerprint('success', yaml.replace('name: Test', 'name: Another')),
    passed.scenarioEvidence,
  );
  assert.doesNotThrow(() => requireScenarioEvidence({ ...plan, disposition: 'blocked' }, []));
});

test('a ready plan with proven flows can be resubmitted after inspecting the live screen', () => {
  const journal = [reset, passed];
  assert.throws(() => requireScenarioEvidence(plan, journal), /inspect_screen/);
  journal.push({ tool: 'screenshot', ok: true }, { tool: 'inspect_screen', ok: false });
  assert.throws(() => requireScenarioEvidence(plan, journal), /inspect_screen/);
  journal.push({ tool: 'inspect_screen', ok: true });
  assert.doesNotThrow(() => requireScenarioEvidence(plan, journal));
});

test('the untouched initial install can be reused once, but not after a flow', () => {
  const evidence = new ScenarioEvidence({ initialResetReady: true });
  assert.equal(evidence.consumeInitialReset(), true);
  assert.equal(evidence.consumeInitialReset(), false);
  const touched = new ScenarioEvidence({ initialResetReady: true });
  touched.beginFlow();
  assert.equal(touched.consumeInitialReset(), false);
});

test('timeout diagnostics distinguish simulator tool failures from unsupported auth speculation', () => {
  const message = agentFailureMessage({ timedOut: true }, [reset, { ...passed, ok: false }]);
  assert.match(message, /25-minute exploration deadline/);
  assert.match(message, /Failed tool calls: 1 \(execute_flow\)/);
  assert.doesNotMatch(message, /authentication|quota/);
});
