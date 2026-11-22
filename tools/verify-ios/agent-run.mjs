import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { ADAPTER_TIMEOUT_MS, EXPLORATION_MS, agentFailureMessage } from './exploration.mjs';
import { cleanEnv } from './process.mjs';
import { initialProvider, isCopilotQuotaExhausted, providerConfig } from './provider.mjs';

async function readJournal(evidence) {
  const journal = await readFile(`${evidence}/tool-calls.jsonl`, 'utf8').catch((error) => {
    if (error.code === 'ENOENT') return '';
    throw error;
  });
  return journal.trim().split('\n').filter(Boolean).map(JSON.parse);
}

async function archiveQuotaAttempt(evidence) {
  const archive = `${evidence}/copilot-quota`;
  await mkdir(archive);
  // The active plan, journal and generated flows must all belong to the same attempt.
  for (const file of [
    'agent.jsonl',
    'tool-calls.jsonl',
    'exploration',
    'generated',
    'plan.json',
    'test-plan.md',
  ]) {
    try {
      await rename(`${evidence}/${file}`, `${archive}/${file}`);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  await mkdir(`${evidence}/exploration`);
}

export async function runExploration({
  toolRoot,
  work,
  source,
  evidence,
  udid,
  appPath,
  fixtureToken,
  initialResetReady,
  attempts,
  signal,
  run,
  resetForFallback,
  env = process.env,
}) {
  const deadline = Date.now() + EXPLORATION_MS;
  const prompt = await readFile(`${toolRoot}/prompt.md`, 'utf8');
  let provider = initialProvider(env);
  let config = providerConfig(provider, env);
  let priorCalls = 0;
  while (true) {
    signal.throwIfAborted();
    const attempt = { provider, model: config.model };
    attempts.push(attempt);

    const cwd = `${work}/agent-${provider}`;
    await mkdir(cwd);
    const mcpFile = `${work}/mcp-${provider}.json`;
    await writeFile(
      mcpFile,
      JSON.stringify({
        mcpServers: {
          verify: {
            type: 'local',
            command: process.execPath,
            args: [`${toolRoot}/agent-tools.mjs`],
            tools: ['*'],
            timeout: ADAPTER_TIMEOUT_MS,
            env: {
              GITHUB_TOKEN: '',
              GH_TOKEN: '',
              COPILOT_GITHUB_TOKEN: '',
              COPILOT_PROVIDER_API_KEY: '',
              VERIFY_AGENT_DEADLINE: String(deadline),
              VERIFY_PRIOR_CALLS: String(priorCalls),
              VERIFY_INITIAL_RESET_READY: initialResetReady ? '1' : '0',
              VERIFY_EVIDENCE: evidence,
              VERIFY_SOURCE: source,
              VERIFY_UDID: udid,
              VERIFY_APP: appPath,
              VERIFY_FIXTURE_TOKEN: fixtureToken,
              MAESTRO_CLI_NO_ANALYTICS: '1',
            },
          },
        },
      }),
      { mode: 0o600 },
    );

    const agent = await run(
      `${toolRoot}/node_modules/.bin/copilot`,
      [
        '-p',
        prompt,
        '--model',
        config.model,
        '--additional-mcp-config',
        `@${mcpFile}`,
        '--disable-builtin-mcps',
        '--disable-mcp-server',
        'computer-use',
        '--no-custom-instructions',
        '--no-ask-user',
        '--no-auto-update',
        '--output-format',
        'json',
        '--allow-tool',
        'verify',
        '--deny-tool',
        'shell,read,write,url,task',
        '--secret-env-vars=GITHUB_TOKEN,COPILOT_PROVIDER_API_KEY',
      ],
      {
        cwd,
        env: { ...cleanEnv(env), ...config.env, COPILOT_HOME: `${work}/home-${provider}` },
        timeout: Math.max(1, deadline - Date.now()),
        log: `${evidence}/agent.jsonl`,
        captureStdoutTail: true,
        allowFailure: true,
      },
    );
    signal.throwIfAborted();
    const journal = await readJournal(evidence);
    if (provider === 'copilot' && isCopilotQuotaExhausted(agent, agent.stdoutTail)) {
      attempt.reason = 'quota_exhausted';
      if (!env.OPENROUTER_API_KEY?.trim())
        throw new Error(
          'Copilot quota exhausted. Configure OPENROUTER_API_KEY to enable the free OpenRouter fallback.',
        );
      provider = 'openrouter';
      config = providerConfig(provider, env);
      await archiveQuotaAttempt(evidence);
      priorCalls = journal.length;
      // Both attempts share one exploration deadline. Reset the app even if the first
      // attempt touched it without completing a journal entry.
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error('Copilot quota exhausted at the exploration deadline.');
      await resetForFallback(
        AbortSignal.any([signal, AbortSignal.timeout(Math.min(90000, remaining))]),
      );
      initialResetReady = true;
      continue;
    }
    if (agent.timedOut || agent.cancelled || agent.code !== 0)
      throw new Error(agentFailureMessage(agent, journal, provider));
    return journal;
  }
}
