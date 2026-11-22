import { Buffer } from 'node:buffer';
import { parseAllDocuments, visit, isAlias } from 'yaml';
import { z } from 'zod';

export const APP_ID = 'com.ryan.aquino.settledown';
export const flowFilePattern = /^\.maestro\/[a-zA-Z0-9][a-zA-Z0-9_-]*\.ya?ml$/;
export const PRESETS = [
  'success',
  'missing-discount',
  'upload-error',
  'scan-mismatch-once',
  'scan-mismatch',
  'groups-error',
  'no-groups',
  'users-error',
  'out-of-order-members',
  'sync-error',
];
// Explicit harness exclusions, not a general escape hatch for missing coverage.
export const MANUAL_CHECKS = [
  'Pinch-to-zoom: Maestro does not support two-finger gestures.',
  'Camera mount-error Retry: native camera failure injection is unavailable.',
  'Camera capture-failure recovery: native camera failure injection is unavailable.',
];
const manualChecks = z.array(z.enum(MANUAL_CHECKS)).max(3).default([]);
const text = z.string().min(1).max(2000);
const selectorObject = z
  .strictObject({
    text: text.optional(),
    id: text.optional(),
    index: z.number().int().min(0).max(100).optional(),
    enabled: z.boolean().optional(),
    checked: z.boolean().optional(),
    focused: z.boolean().optional(),
  })
  .refine((s) => s.text !== undefined || s.id !== undefined, 'A text or id selector is required');
const selector = z.union([text, selectorObject]);
const relativePoint = z
  .string()
  .max(24)
  .regex(/^\d{1,3}(?:\.\d{1,2})?%,\s*\d{1,3}(?:\.\d{1,2})?%$/)
  .refine(
    (value) => value.split(',').every((part) => parseFloat(part) >= 0 && parseFloat(part) <= 100),
    'Point must stay within the selected element',
  );
const tapSelector = z.union([text, selectorObject.safeExtend({ point: relativePoint.optional() })]);
const direction = z.enum(['UP', 'DOWN', 'LEFT', 'RIGHT']);
const empty = z.union([z.null(), z.strictObject({})]);
const permissionState = z.enum(['allow', 'deny']);
const launchPermissions = z
  .strictObject({
    all: permissionState.optional(),
    camera: permissionState.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'At least one permission is required');
const commands = {
  // Restrict runtime changes to camera permission for the app under test.
  setPermissions: z.strictObject({ permissions: z.strictObject({ camera: permissionState }) }),
  launchApp: z.union([
    empty,
    z.strictObject({
      clearState: z.boolean().optional(),
      stopApp: z.boolean().optional(),
      permissions: launchPermissions.optional(),
    }),
  ]),
  pressKey: z.enum(['Home']),
  stopApp: empty,
  back: empty,
  hideKeyboard: empty,
  scroll: empty,
  tapOn: tapSelector,
  doubleTapOn: selector,
  longPressOn: selector,
  assertVisible: selector,
  assertNotVisible: selector,
  inputText: z.string().max(1000),
  eraseText: z.union([empty, z.number().int().min(1).max(500)]),
  takeScreenshot: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
  waitForAnimationToEnd: z.union([
    empty,
    z.strictObject({ timeout: z.number().int().min(1).max(10000) }),
  ]),
  extendedWaitUntil: z
    .strictObject({
      visible: selector.optional(),
      notVisible: selector.optional(),
      timeout: z.number().int().min(1).max(30000),
    })
    .refine((v) => Number(v.visible !== undefined) + Number(v.notVisible !== undefined) === 1),
  scrollUntilVisible: z.strictObject({
    element: selector,
    direction: direction.optional(),
    timeout: z.number().int().min(1).max(30000).optional(),
    speed: z.number().int().min(1).max(100).optional(),
    visibilityPercentage: z.number().min(1).max(100).optional(),
    centerElement: z.boolean().optional(),
  }),
  swipe: z.strictObject({ direction, duration: z.number().int().min(100).max(3000).optional() }),
};

// All Maestro values can evaluate JavaScript. Accept only literal data, even in
// selectors and nested values; an allowlist of top-level command names is insufficient.
export function validateFlow(yaml, { replay = false } = {}) {
  if (typeof yaml !== 'string' || Buffer.byteLength(yaml) > 32000)
    throw new Error('Flow exceeds 32 KB');
  const docs = parseAllDocuments(yaml, { uniqueKeys: true, strict: true });
  if (docs.length !== 2) throw new Error('Expected app header, ---, and commands');
  for (const doc of docs) {
    if (doc.errors.length || doc.warnings.length) throw new Error('Invalid or unsupported YAML');
    visit(doc, (_, node) => {
      if (isAlias(node) || node?.anchor || node?.tag)
        throw new Error('YAML aliases, anchors and tags are forbidden');
    });
  }
  const header = z
    .strictObject({ appId: z.enum([APP_ID, '${APP_ID}']), name: text.optional() })
    .parse(docs[0].toJS());
  const steps = docs[1].toJS({ maxAliasCount: 0 });
  if (!Array.isArray(steps) || !steps.length || steps.length > 80)
    throw new Error('Expected 1–80 commands');
  if (JSON.stringify(steps).includes('${') || JSON.stringify(header.name || '').includes('${')) {
    throw new Error('Executable expressions are forbidden');
  }
  let count = 0;
  const validateSteps = (items, depth = 0) =>
    items.map((step) => {
      if (++count > 80) throw new Error('Expected 1–80 commands including conditional bodies');
      const entry = typeof step === 'string' ? { [step]: null } : step;
      if (
        !entry ||
        typeof entry !== 'object' ||
        Array.isArray(entry) ||
        Object.keys(entry).length !== 1
      )
        throw new Error('Expected exactly one command per step');
      const [name, value] = Object.entries(entry)[0];
      if (name === 'runFlow') {
        if (depth > 0) throw new Error('Nested conditional flows are forbidden');
        // Only literal, inline navigation branches. No file/env/JavaScript/hook
        // options, optional assertions, app launches, or screenshots in branches.
        const branch = z
          .strictObject({
            when: z
              .strictObject({ visible: selector.optional(), notVisible: selector.optional() })
              .refine(
                (v) => Number(v.visible !== undefined) + Number(v.notVisible !== undefined) === 1,
              ),
            commands: z.array(z.unknown()).min(1).max(20),
          })
          .parse(value);
        const names = validateSteps(branch.commands, depth + 1);
        if (
          names.some(
            (command) =>
              ![
                'tapOn',
                'back',
                'scroll',
                'scrollUntilVisible',
                'swipe',
                'hideKeyboard',
                'waitForAnimationToEnd',
              ].includes(command),
          )
        )
          throw new Error('Conditional bodies may only navigate; keep assertions unconditional');
      } else {
        if (!Object.hasOwn(commands, name)) throw new Error(`Forbidden command: ${name}`);
        commands[name].parse(value);
      }
      return name;
    });
  const names = validateSteps(steps);
  if (
    replay &&
    (names[0] !== 'launchApp' ||
      !names.includes('assertVisible') ||
      !names.includes('takeScreenshot'))
  ) {
    throw new Error(
      'Replay must start with launchApp and include assertVisible and takeScreenshot',
    );
  }
  return { header, steps, names };
}

export const planSchema = z.strictObject({
  disposition: z.enum(['ready', 'skipped', 'blocked']),
  rationale: z.string().min(20).max(8000),
  // Unverified changes that block a verdict: simulator-side gaps and failures.
  limitations: z.array(text).max(20),
  // Changes only a physical device can verify (camera sensor, orientation, focus).
  // CI is simulator-only by design, so these are reported but never block PASS.
  deviceOnly: z.array(text).max(20).default([]),
  manualChecks,
  scenarios: z
    .array(
      z.strictObject({
        id: z.string().regex(/^[a-z][a-z0-9-]{0,39}$/),
        name: text,
        coverage: text,
        fixture: z.enum(PRESETS),
        yaml: z.string().max(32000),
      }),
    )
    .max(3),
});

export function validatePlan(input) {
  const plan = planSchema.parse(input);
  if (plan.disposition === 'ready' && !plan.scenarios.length)
    throw new Error('Ready requires scenarios');
  if (plan.disposition === 'skipped' && plan.scenarios.length)
    throw new Error('Skipped cannot contain scenarios');
  if (plan.disposition !== 'blocked' && plan.limitations.length)
    throw new Error(
      'Limitations block verification; submit blocked, or move physical-device-only gaps to deviceOnly',
    );
  if (plan.disposition === 'blocked' && !plan.limitations.length)
    throw new Error(
      'Blocked requires a simulator-side limitation. Physical-device-only gaps belong in deviceOnly with ready or skipped',
    );
  if (new Set(plan.scenarios.map((s) => s.id)).size !== plan.scenarios.length)
    throw new Error('Duplicate scenario IDs');
  for (const scenario of plan.scenarios) validateFlow(scenario.yaml, { replay: true });
  return plan;
}

export function verdict(result, conclusion = 'success') {
  if (conclusion === 'cancelled') return 'CANCELLED';
  if (!result || result.setupError || !result.agentCompleted) return 'BLOCKED';
  if (result.scenarios?.some((s) => s.status === 'FAIL')) return 'FAIL';
  if (conclusion !== 'success') return 'BLOCKED';
  if (result.disposition === 'skipped' && result.scenarios?.length === 0) return 'SKIPPED';
  if (result.disposition !== 'ready' || result.limitations?.length) return 'BLOCKED';
  return result.scenarios?.length > 0 &&
    result.scenarios.every(
      (s) => s.status === 'PASS' && s.exitCode === 0 && s.junitVerified === true,
    )
    ? 'PASS'
    : 'BLOCKED';
}

export const checkConclusion = {
  PASS: 'success',
  FAIL: 'failure',
  BLOCKED: 'failure',
  SKIPPED: 'neutral',
  CANCELLED: 'cancelled',
};

export const resultSchema = z.strictObject({
  version: z.literal(1),
  headSha: z.string().regex(/^[a-f0-9]{40}$/),
  agentCompleted: z.boolean(),
  agentAttempts: z
    .array(
      z.strictObject({
        provider: z.enum(['copilot', 'openrouter']),
        model: z
          .string()
          .max(256)
          .regex(/^[a-zA-Z0-9./_:+-]+$/),
        reason: z.literal('quota_exhausted').optional(),
      }),
    )
    .max(2)
    .optional(),
  disposition: z.enum(['ready', 'skipped', 'blocked']),
  rationale: z.string().max(8000).optional(),
  setupError: z.string().max(16000).optional(),
  limitations: z.array(z.string().max(16000)).max(30),
  deviceOnly: z.array(z.string().max(16000)).max(30).optional(),
  manualChecks,
  verdict: z.enum(['PASS', 'FAIL', 'BLOCKED', 'SKIPPED', 'CANCELLED']),
  scenarios: z
    .array(
      z.strictObject({
        id: z.string().regex(/^[a-z][a-z0-9-]{0,39}$/),
        name: text,
        coverage: text,
        fixture: z.enum(PRESETS),
        status: z.enum(['PASS', 'FAIL', 'BLOCKED']),
        exitCode: z.number().int().nullable().optional(),
        junitVerified: z.boolean().optional(),
        error: z.string().max(16000).optional(),
      }),
    )
    .max(3),
});
