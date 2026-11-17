import { provisionSimulator } from './simulator-setup.mjs';
import { cameraRegressionsApply, runCameraRegressions } from './camera-regressions.mjs';
import { EXPLORATION_MS, requireScenarioEvidence, agentFailureMessage } from './exploration.mjs';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { appendFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { APP_ID, PRESETS, validatePlan, validateFlow, verdict } from './policy.mjs';
import { startFixtures, receipt, groups, members } from './fixtures.mjs';
import { receiptPng } from './receipt-image.mjs';
import { cleanEnv, run as runCommand, resetScenario, stopProcess } from './process.mjs';

const toolRoot = path.dirname(fileURLToPath(import.meta.url));

// Escapes workflow command data so untrusted text cannot end or start a command.
export const escapeCommandData = (value) =>
  value.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');

export function checkJUnit(xml) {
  if (XMLValidator.validate(xml) !== true || /<!DOCTYPE|<!ENTITY/i.test(xml)) return false;
  const tree = new XMLParser({ ignoreAttributes: false }).parse(xml);
  const cases = [];
  let failedTotals = false;
  const walk = node => {
    if (!node || typeof node !== 'object') return;
    for (const [key, value] of Object.entries(node)) {
      if (['@_failures', '@_errors', '@_skipped'].includes(key) && Number(value) !== 0) failedTotals = true;
      if (key === 'testcase') cases.push(...(Array.isArray(value) ? value : [value]));
      else if (typeof value === 'object') (Array.isArray(value) ? value : [value]).forEach(walk);
    }
  };
  walk(tree);
  return !failedTotals && cases.length > 0 && cases.every(c => c && typeof c === 'object'
    && !Object.hasOwn(c, 'failure') && !Object.hasOwn(c, 'error') && !Object.hasOwn(c, 'skipped'));
}

export async function cleanupRuntime({ udid, video, simulatorLog, fixtureServer, evidence, cancelledAt = () => undefined }) {
  const deadline = Date.now() + 15000;
  const remaining = () => Math.max(0, Math.min(deadline, (cancelledAt() ?? Infinity) + 5000) - Date.now());
  const cleanupCommand = async args => {
    const budget = Math.min(3000, remaining());
    if (budget <= 100) return;
    await runCommand('xcrun', args, { timeout: budget - 100, killGraceMs: 100, allowFailure: true });
  };
  const recordingStopped = stopProcess(video, { signal: 'SIGINT', timeout: Math.min(4000, remaining()) });
  await Promise.allSettled([
    recordingStopped,
    stopProcess(simulatorLog, { timeout: Math.min(500, remaining()) }),
    (async () => {
      if (!udid) return;
      await cleanupCommand(['simctl', 'io', udid, 'screenshot', `${evidence}/final.png`]).catch(() => {});
      await recordingStopped; // Keep the simulator alive while its video flushes.
      await cleanupCommand(['simctl', 'shutdown', udid]).catch(() => {});
      await cleanupCommand(['simctl', 'delete', udid]).catch(() => {});
    })(),
    fixtureServer && new Promise(resolve => { fixtureServer.close(resolve); fixtureServer.closeAllConnections(); }),
  ]);
}

async function main() {
  const [sourceArg, requestArg, archiveArg, evidenceArg] = process.argv.slice(2);
  const source = path.resolve(sourceArg), evidence = path.resolve(evidenceArg);
  await mkdir(`${evidence}/exploration`, { recursive: true });
  const result = {
    version: 1,
    agentCompleted: false,
    disposition: 'blocked',
    limitations: [],
    deviceOnly: [],
    manualChecks: [],
    scenarios: [],
  };
  const work = await mkdtemp(path.join(os.tmpdir(), 'verify-ios-'));
  let udid, fixtureServer, video, simulatorLog, cancelledAt;
  let cancelled = false;
  const cancellation = new AbortController();
  const cancel = () => {
    if (cancelled) return;
    cancelled = true;
    cancelledAt = Date.now();
    cancellation.abort(new Error('Verification cancelled'));
  };
  for (const name of ['SIGINT', 'SIGTERM']) process.on(name, cancel);
  const run = (command, args, options = {}) => runCommand(command, args, { ...options, signal: cancellation.signal });
  try {
    const request = JSON.parse(await readFile(path.join(requestArg, 'request.json'), 'utf8'));
    result.headSha = request.headSha;
    if (![request.headSha, request.baseSha].every(s => /^[a-f0-9]{40}$/.test(s))) throw new Error('Invalid captured SHA');
    const actualHead = (await run('git', ['rev-parse', 'HEAD'], { cwd: source })).output.trim();
    if (actualHead !== request.headSha) throw new Error('PR checkout SHA mismatch');
    const git = args => run('git', args, { cwd: source });
    const mergeBase = (await git(['merge-base', request.baseSha, request.headSha])).output.trim();
    const diff = (
      await git([
        'diff',
        '--no-ext-diff',
        '--no-textconv',
        '--no-renames',
        mergeBase,
        request.headSha,
      ])
    ).output;
    const changedFiles = (
      await git(['diff', '--name-only', '--no-renames', '-z', mergeBase, request.headSha])
    ).output
      .split('\0')
      .filter(Boolean);
    // Per-file diffs let the agent page through one file at a time; a single
    // blob over Copilot's tool-output limit would be hidden from the model.
    const diffs = [];
    let diffBudget = 150000;
    for (const file of changedFiles) {
      const text = (
        await git([
          'diff',
          '--no-ext-diff',
          '--no-textconv',
          '--no-renames',
          mergeBase,
          request.headSha,
          '--',
          `:(literal)${file}`,
        ])
      ).output;
      const lines = text.split('\n');
      diffs.push({
        file,
        additions: lines.filter((l) => l.startsWith('+') && !l.startsWith('+++')).length,
        deletions: lines.filter((l) => l.startsWith('-') && !l.startsWith('---')).length,
        truncated: text.length > diffBudget,
        text: text.slice(0, Math.max(0, diffBudget)),
      });
      diffBudget -= text.length;
    }
    const sourceFiles = (await git(['ls-files', '-z'])).output
      .split('\0')
      .filter((f) => /\.(tsx?|jsx?|json|md)$/.test(f) && !/(^|\/)\.|(^|\/)node_modules\//.test(f));
    await writeFile(
      `${evidence}/context.json`,
      JSON.stringify(
        {
          request,
          pr: JSON.parse(await readFile(path.join(requestArg, 'pr.json'), 'utf8')),
          mergeBase,
          changedFiles,
          sourceFiles,
          diffs,
          diffTruncated: diffs.some((d) => d.truncated),
          fixtures: {
            presets: PRESETS,
            receipt,
            groups,
            members,
            notes:
              'The app calls 127.0.0.1:8765. Reset selects one preset. No real OCR or transactions. One receipt photo is preseeded.',
          },
        },
        null,
        2,
      ),
    );
    await writeFile(`${evidence}/pr.diff`, diff);

    const versions = {};
    for (const [name, command, args] of [
      ['xcode', 'xcodebuild', ['-version']], ['node', 'node', ['--version']],
      ['maestro', 'maestro', ['--version']], ['java', 'java', ['-version']],
    ]) versions[name] = (await run(command, args)).output.trim();
    versions.copilot = JSON.parse(await readFile(`${toolRoot}/node_modules/@github/copilot/package.json`, 'utf8')).version;
    await writeFile(`${evidence}/versions.json`, JSON.stringify(versions, null, 2));
    if (process.env.GITHUB_ACTIONS === 'true' && process.env.VERIFY_LOCAL_IOS_RUNTIME) throw new Error('Simulator runtime overrides are local-only');
    const runtime = process.env.VERIFY_LOCAL_IOS_RUNTIME || 'com.apple.CoreSimulator.SimRuntime.iOS-26-5';
    const runtimes = JSON.parse((await run('xcrun', ['simctl', 'list', 'runtimes', '-j'])).output);
    if (!runtimes.runtimes.some(r => r.identifier === runtime && r.isAvailable)) throw new Error(`Required simulator runtime ${runtime} is unavailable`);
    const entries = (await run('tar', ['-tzf', path.resolve(archiveArg)])).output.trim().split('\n');
    const appName = entries[0]?.split('/')[0];
    if (!/^[a-zA-Z0-9_-]+\.app$/.test(appName) || entries.some(e => e.startsWith('/') || e.split('/').includes('..') || e.split('/')[0] !== appName)) {
      throw new Error('Invalid app archive paths');
    }
    await mkdir(`${work}/app`);
    await run('tar', ['-xzf', path.resolve(archiveArg), '-C', `${work}/app`]);
    const appPath = `${work}/app/${appName}`;
    const fixtureToken = randomBytes(24).toString('hex');
    await writeFile(`${evidence}/receipt.png`, receiptPng());
    fixtureServer = await startFixtures({ token: fixtureToken, logPath: `${evidence}/backend.jsonl`, imagePath: `${evidence}/receipt.png` });
    udid = await provisionSimulator({ run, cleanupRun: runCommand, evidence, runtime, runId: request.runId,
      appPath, imagePath: `${evidence}/receipt.png`, token: fixtureToken, signal: cancellation.signal });
    video = spawn('xcrun', ['simctl', 'io', udid, 'recordVideo', '--codec=h264', `${evidence}/session.mp4`], { env: cleanEnv(), stdio: 'ignore' });
    video.once('error', error => console.error(`Recording failed: ${error.message}`));
    simulatorLog = spawn('xcrun', ['simctl', 'spawn', udid, 'log', 'stream', '--level', 'error', '--style', 'compact'], { env: cleanEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
    const { createWriteStream } = await import('node:fs');
    const logStream = createWriteStream(`${evidence}/simulator.log`);
    simulatorLog.stdout.pipe(logStream); simulatorLog.stderr.pipe(logStream, { end: false });

    const regressions = cameraRegressionsApply(changedFiles)
      ? await runCameraRegressions({ udid, appPath, evidence, token: fixtureToken, run, resetScenario, checkJUnit, signal: cancellation.signal, initialResetReady: true }) : [];
    const capturedContext = JSON.parse(await readFile(`${evidence}/context.json`, 'utf8'));
    capturedContext.regressions = regressions.map(record => ({ id: record.scenario.id, name: record.scenario.name, coverage: record.scenario.coverage, status: record.status, evidencePath: record.evidencePath, error: record.error }));
    await writeFile(`${evidence}/context.json`, JSON.stringify(capturedContext, null, 2));
    const agentWork = `${work}/agent`;
    await mkdir(agentWork);
    const agentEnv = { ...cleanEnv(), GITHUB_TOKEN: process.env.GITHUB_TOKEN, COPILOT_HOME: `${work}/copilot-home` };
    const agentDeadline = Date.now() + EXPLORATION_MS;
    const config = { mcpServers: { verify: { type: 'local', command: process.execPath,
      args: [`${toolRoot}/agent-tools.mjs`], tools: ['*'], env: {
        GITHUB_TOKEN: '', GH_TOKEN: '', COPILOT_GITHUB_TOKEN: '',
        VERIFY_AGENT_DEADLINE: String(agentDeadline), VERIFY_INITIAL_RESET_READY: regressions.length ? '0' : '1',
        VERIFY_EVIDENCE: evidence, VERIFY_SOURCE: source, VERIFY_UDID: udid, VERIFY_APP: appPath,
        VERIFY_FIXTURE_TOKEN: fixtureToken, MAESTRO_CLI_NO_ANALYTICS: '1',
      } } } };
    await writeFile(`${work}/mcp.json`, JSON.stringify(config));
    const agent = await run(`${toolRoot}/node_modules/.bin/copilot`, [
      '-p', await readFile(`${toolRoot}/prompt.md`, 'utf8'), '--model', 'auto',
      '--additional-mcp-config', `@${work}/mcp.json`, '--disable-builtin-mcps', '--disable-mcp-server', 'computer-use',
      '--no-custom-instructions', '--no-ask-user', '--no-auto-update', '--output-format', 'json',
      '--allow-tool', 'verify', '--deny-tool', 'shell,read,write,url,task',
    ], { cwd: agentWork, env: agentEnv, timeout: Math.max(1, agentDeadline - Date.now()), log: `${evidence}/agent.jsonl`, allowFailure: true });
    const journal = (await readFile(`${evidence}/tool-calls.jsonl`, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
    if (cancelled || agent.timedOut || agent.code !== 0) throw new Error(agentFailureMessage(agent, journal));
    const plan = validatePlan(JSON.parse(await readFile(`${evidence}/plan.json`, 'utf8')));
    requireScenarioEvidence(plan, journal, regressions);
    if (plan.disposition === 'ready' && (!journal.some(c => c.tool === 'inspect_screen' && c.ok)
      || (!journal.some(c => c.tool === 'execute_flow') && !regressions.some(record => record.status === 'PASS')))) throw new Error('Agent did not inspect and interact with the live UI');
    result.agentCompleted = true;
    result.disposition = plan.disposition;
    result.rationale = plan.rationale;
    result.limitations = plan.limitations;
    result.deviceOnly = plan.deviceOnly;
    result.manualChecks = plan.manualChecks;
    const replayDeadline = Date.now() + 10 * 60_000;
    for (const scenario of plan.scenarios) {
      const record = { id: scenario.id, name: scenario.name, coverage: scenario.coverage, fixture: scenario.fixture, status: 'BLOCKED' };
      result.scenarios.push(record);
      try {
        if (cancelled || Date.now() >= replayDeadline) throw new Error('Replay budget exhausted or cancelled');
        validateFlow(scenario.yaml, { replay: true });
        const directory = `${evidence}/replay/${scenario.id}`;
        await mkdir(directory, { recursive: true });
        await resetScenario({ udid, appPath, appId: APP_ID, fixture: scenario.fixture, phase: scenario.id, token: fixtureToken, signal: cancellation.signal });
        const execution = await run('maestro', ['--device', udid, 'test', '--format', 'junit', '--output', `${directory}/junit.xml`,
          '--debug-output', directory, '--test-output-dir', directory, '-e', `APP_ID=${APP_ID}`, `${evidence}/generated/${scenario.id}.yaml`],
        { timeout: Math.max(1, replayDeadline - Date.now()), log: `${directory}/maestro.log`, allowFailure: true });
        record.exitCode = execution.code;
        let junit;
        try { junit = await readFile(`${directory}/junit.xml`, 'utf8'); } catch { /* absent report is blocked */ }
        record.junitVerified = !!junit && checkJUnit(junit);
        // Tool/driver failures with no JUnit evidence are blocked, not app failures.
        record.status = execution.timedOut || !junit ? 'BLOCKED' : execution.code === 0 && record.junitVerified ? 'PASS' : 'FAIL';
      } catch (error) { record.error = error.message; result.limitations.push(`${scenario.name}: ${error.message}`); }
    }
  } catch (error) {
    result.setupError = error.message;
    console.error(error.message);
  } finally {
    const persist = async () => {
      result.verdict = verdict(result, cancelled ? 'cancelled' : 'success');
      await writeFile(`${evidence}/result.json`, JSON.stringify(result, null, 2));
      const report = [
        '# iOS PR Verification',
        '',
        `Verdict: **${result.verdict}**`,
        `Commit: ${result.headSha || 'unknown'}`,
        '',
        result.rationale || result.setupError || 'No scenarios completed.',
        '',
        ...result.scenarios.map(
          (s) => `- ${s.status}: ${s.name} - ${s.coverage}${s.error ? ` (${s.error})` : ''}`,
        ),
        '',
        ...result.limitations.map((s) => `- Limitation: ${s}`),
        ...result.manualChecks.map(s => `- Manual check (not verified in CI): ${s}`),
        ...result.deviceOnly.map((s) => `- Requires a physical device (not verified in CI): ${s}`),
      ].join('\n');
      await writeFile(`${evidence}/report.md`, report);
      // The job log is otherwise silent; surface the verdict where a failed step is read.
      // Agent text derives from PR content, so workflow commands are fenced off.
      const fence = randomBytes(16).toString('hex');
      console.log(`::stop-commands::${fence}\n${report}\n::${fence}::`);
      if (process.env.GITHUB_STEP_SUMMARY)
        await appendFile(process.env.GITHUB_STEP_SUMMARY, `${report}\n`).catch(() => {});
      if (!['PASS', 'SKIPPED'].includes(result.verdict)) {
        const detail =
          result.setupError ||
          result.limitations[0] ||
          result.rationale ||
          'See report.md in the ios-evidence artifact.';
        console.log(
          `::error title=iOS verification ${result.verdict}::${escapeCommandData(detail.slice(0, 1000))}`,
        );
        process.exitCode = 1;
      }
    };
    try {
      // Persist before touching potentially unresponsive simulator services. On
      // cancellation, finish cleanup within the initial Actions signal grace.
      await persist();
      await cleanupRuntime({ udid, video, simulatorLog, fixtureServer, evidence, cancelledAt: () => cancelledAt });
      await persist(); // A signal may also arrive during normal teardown.
    } finally {
      for (const name of ['SIGINT', 'SIGTERM']) process.off(name, cancel);
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
