import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { APP_ID, PRESETS, validatePlan, validateFlow, verdict } from './policy.mjs';
import { startFixtures, receipt, groups, members } from './fixtures.mjs';
import { receiptPng } from './receipt-image.mjs';
import { cleanEnv, run, resetScenario } from './process.mjs';

const toolRoot = path.dirname(fileURLToPath(import.meta.url));

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

async function main() {
  const [sourceArg, requestArg, archiveArg, evidenceArg] = process.argv.slice(2);
  const source = path.resolve(sourceArg), evidence = path.resolve(evidenceArg);
  await mkdir(`${evidence}/exploration`, { recursive: true });
  const result = { version: 1, agentCompleted: false, disposition: 'blocked', limitations: [], scenarios: [] };
  const work = await mkdtemp(path.join(os.tmpdir(), 'verify-ios-'));
  let udid, fixtureServer, video, videoExit, simulatorLog;
  let cancelled = false;
  process.once('SIGTERM', () => { cancelled = true; });
  try {
    const request = JSON.parse(await readFile(path.join(requestArg, 'request.json'), 'utf8'));
    result.headSha = request.headSha;
    if (![request.headSha, request.baseSha].every(s => /^[a-f0-9]{40}$/.test(s))) throw new Error('Invalid captured SHA');
    const actualHead = (await run('git', ['rev-parse', 'HEAD'], { cwd: source })).output.trim();
    if (actualHead !== request.headSha) throw new Error('PR checkout SHA mismatch');
    const git = args => run('git', args, { cwd: source });
    const mergeBase = (await git(['merge-base', request.baseSha, request.headSha])).output.trim();
    const diff = (await git(['diff', '--no-ext-diff', '--no-textconv', '--no-renames', mergeBase, request.headSha])).output;
    const changedFiles = (await git(['diff', '--name-only', '-z', mergeBase, request.headSha])).output.split('\0').filter(Boolean);
    const sourceFiles = (await git(['ls-files', '-z'])).output.split('\0').filter(f =>
      /\.(tsx?|jsx?|json|md)$/.test(f) && !/(^|\/)\.|(^|\/)node_modules\//.test(f));
    await writeFile(`${evidence}/context.json`, JSON.stringify({
      request, pr: JSON.parse(await readFile(path.join(requestArg, 'pr.json'), 'utf8')),
      mergeBase, changedFiles, sourceFiles, diff: diff.slice(0,150000), diffTruncated: diff.length > 150000,
      fixtures: { presets: PRESETS, receipt, groups, members, notes: 'The app calls localhost:8765. Reset selects one preset. No real OCR or transactions. One receipt photo is preseeded.' },
    }, null, 2));
    await writeFile(`${evidence}/pr.diff`, diff);

    const versions = {};
    for (const [name, command, args] of [
      ['xcode', 'xcodebuild', ['-version']], ['node', 'node', ['--version']],
      ['maestro', 'maestro', ['--version']], ['java', 'java', ['-version']],
    ]) versions[name] = (await run(command, args)).output.trim();
    versions.copilot = JSON.parse(await readFile(`${toolRoot}/node_modules/@github/copilot/package.json`, 'utf8')).version;
    await writeFile(`${evidence}/versions.json`, JSON.stringify(versions, null, 2));
    const runtime = 'com.apple.CoreSimulator.SimRuntime.iOS-26-5';
    const runtimes = JSON.parse((await run('xcrun', ['simctl', 'list', 'runtimes', '-j'])).output);
    if (!runtimes.runtimes.some(r => r.identifier === runtime && r.isAvailable)) throw new Error('Required iOS 26.5 runtime is unavailable');
    udid = (await run('xcrun', ['simctl', 'create', `Verify-${request.runId}`, 'com.apple.CoreSimulator.SimDeviceType.iPhone-17', runtime])).output.trim();
    await run('xcrun', ['simctl', 'boot', udid]);
    await run('xcrun', ['simctl', 'bootstatus', udid, '-b'], { timeout: 180000 });
    await writeFile(`${evidence}/simulator.json`, JSON.stringify({ udid, runtime, model: 'iPhone 17' }));
    await run('xcrun', ['simctl', 'spawn', udid, 'defaults', 'write', 'NSGlobalDomain', 'AppleLanguages', '-array', 'en']);
    await run('xcrun', ['simctl', 'spawn', udid, 'defaults', 'write', 'NSGlobalDomain', 'AppleLocale', '-string', 'en_US']);

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
    await run('xcrun', ['simctl', 'addmedia', udid, `${evidence}/receipt.png`]);
    await resetScenario({ udid, appPath, appId: APP_ID, fixture: 'success', phase: 'initial', token: fixtureToken });
    await run('xcrun', ['simctl', 'io', udid, 'screenshot', `${evidence}/initial.png`]);
    video = spawn('xcrun', ['simctl', 'io', udid, 'recordVideo', '--codec=h264', `${evidence}/session.mp4`], { env: cleanEnv(), stdio: 'ignore' });
    videoExit = new Promise(resolve => { video.once('exit', resolve); video.once('error', resolve); });
    simulatorLog = spawn('xcrun', ['simctl', 'spawn', udid, 'log', 'stream', '--level', 'error', '--style', 'compact'], { env: cleanEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
    const { createWriteStream } = await import('node:fs');
    const logStream = createWriteStream(`${evidence}/simulator.log`);
    simulatorLog.stdout.pipe(logStream); simulatorLog.stderr.pipe(logStream, { end: false });

    const agentWork = `${work}/agent`;
    await mkdir(agentWork);
    const agentEnv = { ...cleanEnv(), GITHUB_TOKEN: process.env.GITHUB_TOKEN, COPILOT_HOME: `${work}/copilot-home` };
    const config = { mcpServers: { verify: { type: 'local', command: process.execPath,
      args: [`${toolRoot}/agent-tools.mjs`], tools: ['*'], env: {
        GITHUB_TOKEN: '', GH_TOKEN: '', COPILOT_GITHUB_TOKEN: '',
        VERIFY_EVIDENCE: evidence, VERIFY_SOURCE: source, VERIFY_UDID: udid, VERIFY_APP: appPath,
        VERIFY_FIXTURE_TOKEN: fixtureToken, MAESTRO_CLI_NO_ANALYTICS: '1',
      } } } };
    await writeFile(`${work}/mcp.json`, JSON.stringify(config));
    const agent = await run(`${toolRoot}/node_modules/.bin/copilot`, [
      '-p', await readFile(`${toolRoot}/prompt.md`, 'utf8'), '--model', 'auto',
      '--additional-mcp-config', `@${work}/mcp.json`, '--disable-builtin-mcps', '--disable-mcp-server', 'computer-use',
      '--no-custom-instructions', '--no-ask-user', '--no-auto-update', '--output-format', 'json',
      '--allow-tool', 'verify', '--deny-tool', 'shell,read,write,url,task',
    ], { cwd: agentWork, env: agentEnv, timeout: 15 * 60_000, log: `${evidence}/agent.jsonl`, allowFailure: true });
    if (cancelled || agent.timedOut || agent.code !== 0) throw new Error(`Copilot ${agent.timedOut ? 'exceeded the exploration budget' : `exited ${agent.code}`}. Check agent.jsonl for authentication, quota, or tool errors.`);
    const plan = validatePlan(JSON.parse(await readFile(`${evidence}/plan.json`, 'utf8')));
    const journal = (await readFile(`${evidence}/tool-calls.jsonl`, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    if (plan.disposition === 'ready' && (!journal.some(c => c.tool === 'inspect_screen' && c.ok)
      || !journal.some(c => c.tool === 'execute_flow'))) throw new Error('Agent did not inspect and interact with the live UI');
    result.agentCompleted = true;
    result.disposition = plan.disposition;
    result.rationale = plan.rationale;
    result.limitations = plan.limitations;
    const replayDeadline = Date.now() + 10 * 60_000;
    for (const scenario of plan.scenarios) {
      const record = { id: scenario.id, name: scenario.name, coverage: scenario.coverage, fixture: scenario.fixture, status: 'BLOCKED' };
      result.scenarios.push(record);
      try {
        if (cancelled || Date.now() >= replayDeadline) throw new Error('Replay budget exhausted or cancelled');
        validateFlow(scenario.yaml, { replay: true });
        const directory = `${evidence}/replay/${scenario.id}`;
        await mkdir(directory, { recursive: true });
        await resetScenario({ udid, appPath, appId: APP_ID, fixture: scenario.fixture, phase: scenario.id, token: fixtureToken });
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
    if (video) {
      video.kill('SIGINT');
      await Promise.race([videoExit, new Promise(resolve => setTimeout(resolve, 8000))]);
      if (video.exitCode === null) video.kill('SIGKILL');
    }
    simulatorLog?.kill('SIGTERM');
    if (udid) {
      await run('xcrun', ['simctl', 'io', udid, 'screenshot', `${evidence}/final.png`], { allowFailure: true }).catch(() => {});
      await run('xcrun', ['simctl', 'shutdown', udid], { allowFailure: true }).catch(() => {});
      await run('xcrun', ['simctl', 'delete', udid], { allowFailure: true }).catch(() => {});
    }
    if (fixtureServer) await new Promise(resolve => fixtureServer.close(resolve));
    result.verdict = verdict(result, cancelled ? 'cancelled' : 'success');
    await writeFile(`${evidence}/result.json`, JSON.stringify(result, null, 2));
    await writeFile(`${evidence}/report.md`, [
      '# iOS PR Verification', '', `Verdict: **${result.verdict}**`, `Commit: ${result.headSha || 'unknown'}`, '',
      result.rationale || result.setupError || 'No scenarios completed.', '',
      ...result.scenarios.map(s => `- ${s.status}: ${s.name} — ${s.coverage}${s.error ? ` (${s.error})` : ''}`),
      '', ...result.limitations.map(s => `- Limitation: ${s}`),
    ].join('\n'));
    if (!['PASS', 'SKIPPED'].includes(result.verdict)) process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
