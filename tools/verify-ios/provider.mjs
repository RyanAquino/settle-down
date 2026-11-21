export function initialProvider(env = process.env) {
  const provider = env.IOS_VERIFY_PROVIDER || 'copilot';
  if (provider !== 'copilot' && provider !== 'openrouter') {
    throw new Error('IOS_VERIFY_PROVIDER must be copilot or openrouter');
  }
  return provider;
}

// Only the CLI process receives the selected provider's credentials.
export function providerConfig(provider, env = process.env) {
  if (provider === 'copilot') return { model: 'auto', env: { GITHUB_TOKEN: env.GITHUB_TOKEN } };
  if (provider !== 'openrouter') throw new Error('Unknown verification provider');

  const model = env.IOS_VERIFY_OPENROUTER_MODEL || 'nvidia/nemotron-3.5-super-vl:free';
  const freeModelId = /^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*:free$/;
  if (model.length > 256 || (model !== 'openrouter/free' && !freeModelId.test(model))) {
    throw new Error(
      'IOS_VERIFY_OPENROUTER_MODEL must be a provider/model:free ID or openrouter/free',
    );
  }
  if (!env.OPENROUTER_API_KEY?.trim()) {
    throw new Error('OPENROUTER_API_KEY is required for OpenRouter verification');
  }
  return {
    model,
    env: {
      COPILOT_PROVIDER_TYPE: 'openai',
      COPILOT_PROVIDER_BASE_URL: 'https://openrouter.ai/api/v1',
      COPILOT_PROVIDER_API_KEY: env.OPENROUTER_API_KEY,
      COPILOT_PROVIDER_VISION: 'true',
    },
  };
}

export function isCopilotQuotaExhausted(agent, output = agent.output) {
  if (!Number.isInteger(agent.code) || agent.code === 0 || agent.cancelled || agent.timedOut) {
    return false;
  }
  // Find the last session error of the final turn. The pinned CLI emits JSONL,
  // including untrusted model messages and tool results, on the same stream.
  for (const line of (output || '').split('\n').reverse()) {
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (
      event?.type === 'assistant.turn_start' ||
      (event?.type === 'result' && event.exitCode === 0)
    )
      return false;
    if (event?.type === 'session.error') {
      return (
        event.data?.errorType === 'quota' ||
        event.data?.errorCode === 'quota_exceeded' ||
        event.data?.providerErrorCode === 'quota_exceeded'
      );
    }
  }
  return false;
}
