import assert from 'node:assert/strict';
import test from 'node:test';
import { initialProvider, isCopilotQuotaExhausted, providerConfig } from '../provider.mjs';

const env = { GITHUB_TOKEN: 'fixture-github', OPENROUTER_API_KEY: 'fixture-openrouter' };

test('Copilot with auto model remains the default even with a configured fallback', () => {
  assert.equal(initialProvider(env), 'copilot');
  assert.equal(initialProvider({ IOS_VERIFY_PROVIDER: '' }), 'copilot');
  assert.deepEqual(providerConfig('copilot', { ...env, IOS_VERIFY_OPENROUTER_MODEL: 'bad' }), {
    model: 'auto',
    env: { GITHUB_TOKEN: env.GITHUB_TOKEN },
  });
  assert.throws(() => initialProvider({ IOS_VERIFY_PROVIDER: 'other' }), /IOS_VERIFY_PROVIDER/);
});

test('OpenRouter uses its free model, vision support, and its own credential', () => {
  const selected = initialProvider({ IOS_VERIFY_PROVIDER: 'openrouter' });
  assert.deepEqual(providerConfig(selected, env), {
    model: 'google/gemma-4-26b-a4b-it:free',
    env: {
      COPILOT_PROVIDER_TYPE: 'openai',
      COPILOT_PROVIDER_BASE_URL: 'https://openrouter.ai/api/v1',
      COPILOT_PROVIDER_API_KEY: env.OPENROUTER_API_KEY,
      COPILOT_PROVIDER_VISION: 'true',
    },
  });
  for (const model of ['openrouter/free', 'vendor/Model_3.2:free']) {
    assert.equal(
      providerConfig(selected, { ...env, IOS_VERIFY_OPENROUTER_MODEL: model }).model,
      model,
    );
  }
  assert.throws(() => providerConfig(selected, {}), /OPENROUTER_API_KEY/);
});

test('invalid or paid model selections cannot initiate paid requests', () => {
  for (const model of [
    'auto',
    'openrouter/auto',
    'vendor/model',
    'vendor/model:FREE',
    'vendor/model:free\n',
    'vendor/../../model:free',
    'vendor/model:free,paid/model',
    'x'.repeat(256) + '/m:free',
  ]) {
    assert.throws(
      () => providerConfig('openrouter', { ...env, IOS_VERIFY_OPENROUTER_MODEL: model }),
      /must be a provider\/model:free/,
    );
  }
});

// CLI 1.0.112 emitted this session.error shape for an HTTP 402 response
// carrying the provider's quota_exceeded code.
const quota = { errorType: 'query', statusCode: 402, providerErrorCode: 'quota_exceeded' };
const sessionError = (data) => JSON.stringify({ type: 'session.error', data });
const result = JSON.stringify({ type: 'result', exitCode: 1 });
const failed = { code: 1, output: [sessionError(quota), result].join('\n') };

test('a terminal, structured Copilot quota error permits fallback', () => {
  assert.equal(isCopilotQuotaExhausted(failed), true);
  for (const data of [{ errorType: 'quota' }, { errorCode: 'quota_exceeded' }]) {
    assert.equal(isCopilotQuotaExhausted(failed, sessionError(data)), true);
  }
});

test('successful, cancelled, interrupted, or timed out CLI sessions never qualify', () => {
  for (const state of [{ code: 0 }, { cancelled: true }, { code: null }, { timedOut: true }]) {
    assert.equal(isCopilotQuotaExhausted({ ...failed, ...state }), false);
  }
});

test('authentication, traffic limits, and generic payment errors are distinct from exhausted quota', () => {
  for (const data of [
    { errorType: 'authentication', statusCode: 401 },
    { errorType: 'rate_limit', statusCode: 429 },
    { errorType: 'query', statusCode: 402, message: 'Payment required' },
    { errorType: 'query', message: 'quota exceeded when using test fixture' },
  ]) {
    assert.equal(isCopilotQuotaExhausted(failed, sessionError(data)), false);
  }
});

test('agent prose, failed Maestro tool results, and recovered errors cannot trigger fallback', () => {
  const quoted = sessionError(quota);
  for (const line of [
    'You exceeded your quota.',
    JSON.stringify({ type: 'assistant.message', data: { content: quoted } }),
    JSON.stringify({ type: 'tool.execution_complete', data: { success: false, error: quoted } }),
    quoted + '\n' + sessionError({ errorType: 'authentication' }),
    quoted + '\n' + JSON.stringify({ type: 'assistant.turn_start' }),
    quoted + '\n' + JSON.stringify({ type: 'result', exitCode: 0 }),
    'null',
  ]) {
    assert.equal(isCopilotQuotaExhausted(failed, line), false);
  }
});
