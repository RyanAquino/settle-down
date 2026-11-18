import { createHash } from 'node:crypto';
import { validateFlow } from './policy.mjs';

export const EXPLORATION_MS = 15 * 60_000;
export const FINALIZE_MS = 2 * 60_000;
const uiTools = new Set(['reset_scenario', 'execute_flow', 'inspect_screen', 'screenshot']);

export class ExplorationBudget {
  constructor({ deadline = Date.now() + EXPLORATION_MS, now = Date.now } = {}) {
    this.deadline = deadline;
    this.now = now;
    this.calls = 0;
    this.finalizing = false;
  }
  snapshot() {
    const secondsRemaining = Math.max(0, Math.floor((this.deadline - this.now()) / 1000));
    return {
      secondsRemaining,
      callsRemaining: Math.max(0, 100 - this.calls),
      phase:
        this.finalizing || secondsRemaining <= FINALIZE_MS / 1000 || this.calls >= 90
          ? 'finalize'
          : 'explore',
    };
  }
  enter(name) {
    this.calls++;
    this.check(name);
  }
  check(name) {
    const remaining = this.deadline - this.now();
    if (
      remaining <= FINALIZE_MS ||
      this.calls >= 90 ||
      (uiTools.has(name) && remaining <= FINALIZE_MS + 90_000)
    )
      this.finalizing = true;
    if (name !== 'submit_plan' && (this.finalizing || this.calls > 100)) {
      throw new Error(
        'Exploration is closed to reserve time for finalization. Submit the best complete plan now; list unfinished coverage as blocking limitations. Do not start another scenario.',
      );
    }
  }
  uiTimeout(maximum) {
    this.check('inspect_screen');
    return Math.max(1, Math.min(maximum, this.deadline - this.now() - FINALIZE_MS));
  }
}

const canonical = (value) =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === 'object'
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, canonical(value[key])]),
        )
      : value;

export function scenarioFingerprint(fixture, yaml) {
  const { steps } = validateFlow(yaml, { replay: true });
  // Header display names, whitespace, selector key order, and the APP_ID spelling
  // do not change the actions. All actions and assertions do affect identity.
  return createHash('sha256')
    .update(JSON.stringify(canonical({ fixture, steps })))
    .digest('hex');
}

export class ScenarioEvidence {
  constructor({ initialResetReady = false } = {}) {
    this.initialResetReady = initialResetReady;
  }
  consumeInitialReset() {
    const ready = this.initialResetReady;
    this.initialResetReady = false;
    return ready;
  }
  resetStarted() {
    this.fixture = undefined;
  }
  resetCompleted(fixture) {
    this.fixture = fixture;
  }
  beginFlow() {
    this.initialResetReady = false;
    const fixture = this.fixture;
    this.fixture = undefined;
    return fixture;
  }
  completed(fixture, yaml, success) {
    if (!fixture || !success) return undefined;
    try {
      return scenarioFingerprint(fixture, yaml);
    } catch {
      return undefined;
    }
  }
}

export function requireScenarioEvidence(plan, journal, regressions = []) {
  if (regressions.length && plan.disposition === 'skipped')
    throw new Error('Required camera regressions apply; this UI change cannot be skipped');
  if (plan.disposition !== 'ready') return;
  const passedRegressions = regressions.filter(
    (record) => record.status === 'PASS' && record.exitCode === 0 && record.junitVerified === true,
  );
  if (passedRegressions.length !== regressions.length)
    throw new Error(
      'A required camera regression failed or is blocked. Preserve it as a blocking limitation; ready is not permitted',
    );
  const proven = new Set(
    passedRegressions.map((record) =>
      scenarioFingerprint(record.scenario.fixture, record.scenario.yaml),
    ),
  );
  let fixture;
  for (const call of [...journal].sort((a, b) => (a.index ?? 0) - (b.index ?? 0))) {
    if (call.tool === 'reset_scenario') fixture = call.ok ? call.args.fixture : undefined;
    if (call.tool !== 'execute_flow' || !fixture) continue;
    let fingerprint;
    try {
      fingerprint = scenarioFingerprint(fixture, call.args.yaml);
    } catch {
      continue;
    }
    if (!call.ok) proven.delete(fingerprint);
    else if (call.scenarioEvidence === fingerprint) proven.add(fingerprint);
  }
  const selected = new Set(
    plan.scenarios.map((scenario) => scenarioFingerprint(scenario.fixture, scenario.yaml)),
  );
  for (const record of regressions) {
    if (!selected.has(scenarioFingerprint(record.scenario.fixture, record.scenario.yaml)))
      throw new Error(
        `Ready must include required regression ${record.scenario.id}; obtain its exact scenario with get_regression`,
      );
  }
  for (const scenario of plan.scenarios) {
    if (!proven.has(scenarioFingerprint(scenario.fixture, scenario.yaml))) {
      throw new Error(
        `Scenario ${scenario.id} has not succeeded as a complete flow immediately after reset_scenario with fixture ${scenario.fixture}. Execute that exact flow after a fresh reset before submitting ready; do not combine exploratory fragments. If time is short, submit blocked with the coverage gap.`,
      );
    }
  }
}

export function agentFailureMessage(agent, journal) {
  const failed = journal.filter((call) => !call.ok);
  const last = journal.at(-1);
  const reason = agent.timedOut
    ? 'reached its 15-minute exploration deadline before completing verification'
    : `exited ${agent.code}`;
  return `Copilot ${reason}. Last completed tool: ${last?.tool || 'none'}. Failed tool calls: ${failed.length}${failed.length ? ` (${[...new Set(failed.map((call) => call.tool))].join(', ')})` : ''}. See agent.jsonl and tool-calls.jsonl for details.`;
}
