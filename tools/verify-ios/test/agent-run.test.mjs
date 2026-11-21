import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { runExploration } from '../agent-run.mjs';

const toolRoot = fileURLToPath(new URL('..', import.meta.url));
const quotaEvent = {
  type: 'session.error',
  data: {
    errorType: 'quota',
    errorCode: 'quota_exceeded',
    statusCode: 402,
    message: 'You have exceeded your premium request allowance.',
  },
};
const quotaOutput = [quotaEvent, { type: 'result', exitCode: 1 }]
  .map((event) => JSON.stringify(event))
  .join('\n');
const quota = {
  code: 1,
  timedOut: false,
  cancelled: false,
  output: quotaOutput,
  stdoutTail: quotaOutput,
};
const success = { code: 0, timedOut: false, cancelled: false, output: '', stdoutTail: '' };

async function harness(t) {
  const work = await mkdtemp(path.join(tmpdir(), 'verify-providers-'));
  t.after(() => rm(work, { recursive: true, force: true }));
  const evidence = path.join(work, 'evidence');
  await mkdir(path.join(evidence, 'exploration'), { recursive: true });
  return {
    toolRoot,
    work,
    source: work,
    evidence,
    udid: 'test-simulator',
    appPath: '/fixture/Settle Down.app',
    fixtureToken: 'test-fixture-token',
    initialResetReady: true,
    attempts: [],
    signal: new AbortController().signal,
    env: {
      GITHUB_TOKEN: 'test-github-credential',
      OPENROUTER_API_KEY: 'test-openrouter-credential',
      IOS_VERIFY_OPENROUTER_MODEL: 'example/vision:free',
    },
    resetForFallback: () => assert.fail('Unexpected fallback reset'),
  };
}

test('Copilot quota restarts exploration once with isolated evidence and the same deadline', async (t) => {
  const options = await harness(t);
  const { evidence, env } = options;
  const calls = [];
  const fresh = { tool: 'inspect_screen', ok: true };
  options.initialResetReady = false;
  let resets = 0;
  options.resetForFallback = () => {
    resets++;
  };
  const run = async (command, args, launch) => {
    const argument = (name) => args[args.indexOf(name) + 1];
    const config = JSON.parse(await readFile(argument('--additional-mcp-config').slice(1), 'utf8'));
    const adapter = config.mcpServers.verify.env;
    const childEnv = { ...launch.env, ...adapter };
    assert.ok(!childEnv.GITHUB_TOKEN);
    assert.ok(!childEnv.OPENROUTER_API_KEY);
    assert.ok(!childEnv.COPILOT_PROVIDER_API_KEY);
    assert.equal(adapter.VERIFY_EVIDENCE, evidence);
    assert.equal(argument('--allow-tool'), 'verify');
    assert.equal(argument('--deny-tool'), 'shell,read,write,url,task');
    assert.ok(command.endsWith('/copilot'));
    calls.push({
      model: argument('--model'),
      cwd: launch.cwd,
      env: launch.env,
      deadline: adapter.VERIFY_AGENT_DEADLINE,
    });
    if (calls.length === 1) {
      assert.equal(resets, 0);
      assert.equal(adapter.VERIFY_INITIAL_RESET_READY, '0');
      assert.equal(adapter.VERIFY_PRIOR_CALLS, '0');
      await writeFile(launch.log, quotaOutput);
      await mkdir(path.join(evidence, 'generated'));
      await writeFile(path.join(evidence, 'generated/old.yaml'), 'old scenario');
      await writeFile(path.join(evidence, 'plan.json'), '{"rationale":"old plan"}');
      await writeFile(
        path.join(evidence, 'tool-calls.jsonl'),
        '{"tool":"execute_flow","ok":true}\n',
      );
      return quota;
    }
    assert.equal(resets, 1);
    assert.equal(adapter.VERIFY_INITIAL_RESET_READY, '1');
    assert.equal(adapter.VERIFY_PRIOR_CALLS, '1');
    for (const file of ['generated/old.yaml', 'plan.json', 'tool-calls.jsonl', 'agent.jsonl']) {
      await access(path.join(evidence, 'copilot-quota', file));
      await assert.rejects(access(path.join(evidence, file)), { code: 'ENOENT' });
    }
    await writeFile(path.join(evidence, 'tool-calls.jsonl'), JSON.stringify(fresh));
    await writeFile(path.join(evidence, 'plan.json'), '{"rationale":"fresh plan"}');
    return success;
  };
  const journal = await runExploration({ ...options, run });
  assert.deepEqual(journal, [fresh]);
  assert.deepEqual(options.attempts, [
    { provider: 'copilot', model: 'auto', reason: 'quota_exhausted' },
    { provider: 'openrouter', model: env.IOS_VERIFY_OPENROUTER_MODEL },
  ]);
  const [copilot, fallback] = calls;
  assert.deepEqual(
    calls.map((call) => call.model),
    ['auto', env.IOS_VERIFY_OPENROUTER_MODEL],
  );
  assert.equal(copilot.env.GITHUB_TOKEN, env.GITHUB_TOKEN);
  assert.ok(!copilot.env.OPENROUTER_API_KEY && !copilot.env.COPILOT_PROVIDER_API_KEY);
  assert.equal(fallback.env.COPILOT_PROVIDER_API_KEY, env.OPENROUTER_API_KEY);
  assert.ok(!fallback.env.GITHUB_TOKEN && !fallback.env.OPENROUTER_API_KEY);
  assert.notEqual(copilot.cwd, fallback.cwd);
  assert.notEqual(copilot.env.COPILOT_HOME, fallback.env.COPILOT_HOME);
  assert.ok(Number(copilot.deadline) > 0);
  assert.equal(copilot.deadline, fallback.deadline);
});

test('a successful default run uses only Copilot even when a fallback key is available', async (t) => {
  const options = await harness(t);
  assert.deepEqual(await runExploration({ ...options, run: async () => success }), []);
  assert.deepEqual(options.attempts, [{ provider: 'copilot', model: 'auto' }]);
});

test('direct OpenRouter selection surfaces its own quota error without retrying', async (t) => {
  const options = await harness(t);
  options.env.IOS_VERIFY_PROVIDER = 'openrouter';
  await assert.rejects(runExploration({ ...options, run: async () => quota }), /OpenRouter/i);
  assert.deepEqual(options.attempts, [
    { provider: 'openrouter', model: options.env.IOS_VERIFY_OPENROUTER_MODEL },
  ]);
});

for (const [name, failure] of [
  ['timeout', { ...quota, timedOut: true }],
  ['cancellation', { ...quota, cancelled: true }],
  ['authentication', { ...quota, output: 'Unauthorized', stdoutTail: 'Unauthorized' }],
  ['failed assertion', { ...quota, output: 'Assertion failed', stdoutTail: 'Assertion failed' }],
]) {
  test(`${name} stops after the Copilot attempt`, async (t) => {
    const options = await harness(t);
    await assert.rejects(runExploration({ ...options, run: async () => failure }));
    assert.deepEqual(options.attempts, [{ provider: 'copilot', model: 'auto' }]);
  });
}

test('Copilot quota exhaustion without a configured key identifies the setting to add', async (t) => {
  const options = await harness(t);
  delete options.env.OPENROUTER_API_KEY;
  await assert.rejects(
    runExploration({ ...options, run: async () => quota }),
    /OPENROUTER_API_KEY/,
  );
  assert.deepEqual(options.attempts, [
    { provider: 'copilot', model: 'auto', reason: 'quota_exhausted' },
  ]);
});
