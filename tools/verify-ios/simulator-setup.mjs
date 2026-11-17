import { appendFile, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { APP_ID } from './policy.mjs';
import { fixtureControl } from './fixture-control.mjs';

// Only infrastructure provisioning is retried. No app assertions or test flows
// run here, and every failed attempt discards its own isolated device.
export async function provisionSimulator({ run, cleanupRun = run, evidence, runtime, runId, appPath, imagePath, token,
  signal, resetFixture = fixtureControl, now = Date.now, simulatorApp }) {
  const attempts = [];
  for (let attempt = 1; attempt <= 2; attempt++) {
    const deadline = now() + 5 * 60_000;
    let udid;
    const record = { attempt, status: 'running' };
    attempts.push(record);
    const perform = async (stage, operation) => {
      record.stage = stage;
      const started = now();
      console.log(`Simulator setup ${attempt}: ${stage}`);
      await appendFile(`${evidence}/setup-commands.jsonl`, `${JSON.stringify({ attempt, stage, event: 'start', time: new Date().toISOString() })}\n`);
      try {
        if (signal?.aborted) throw signal.reason || new Error('Simulator provisioning cancelled');
        const remaining = deadline - now();
        if (remaining <= 0) throw new Error('Simulator provisioning timed out');
        const result = await operation(remaining);
        await appendFile(`${evidence}/setup-commands.jsonl`, `${JSON.stringify({ attempt, stage, event: 'success', durationMs: now() - started })}\n`);
        return result;
      } catch (error) {
        await appendFile(`${evidence}/setup-commands.jsonl`, `${JSON.stringify({ attempt, stage, event: 'failure', durationMs: now() - started, error: error.message })}\n`);
        throw new Error(`Simulator setup ${stage}: ${error.message}`, { cause: error });
      }
    };
    const execute = (stage, command, args, options = {}) => perform(stage, remaining =>
      run(command, args, { ...options, timeout: Math.max(1, Math.min(options.timeout || 60000, remaining)) }));
    try {
      udid = (await execute('create device', 'xcrun', ['simctl', 'create', `Verify-${runId}-${attempt}`, 'com.apple.CoreSimulator.SimDeviceType.iPhone-17', runtime])).output.trim();
      record.udid = udid;
      await execute('boot device', 'xcrun', ['simctl', 'boot', udid]);
      if (simulatorApp) {
        // Xcode 26 has Simulator.app; Xcode 27's local Device Hub may not.
        if (await access(simulatorApp).then(() => true, () => false)) {
          await execute('open simulator window', 'open', ['-a', simulatorApp, '--args', '-CurrentDeviceUDID', udid], { allowFailure: true, timeout: 15000 });
        }
      }
      await execute('wait for boot', 'xcrun', ['simctl', 'bootstatus', udid, '-b'], { timeout: 180000, log: `${evidence}/setup-${attempt}-boot.log` });
      await execute('set language', 'xcrun', ['simctl', 'spawn', udid, 'defaults', 'write', 'NSGlobalDomain', 'AppleLanguages', '-array', 'en'], { timeout: 30000 });
      await execute('set locale', 'xcrun', ['simctl', 'spawn', udid, 'defaults', 'write', 'NSGlobalDomain', 'AppleLocale', '-string', 'en_US'], { timeout: 30000 });
      // Let XCTest and simulator services settle while still on SpringBoard,
      // before the first Photos import or application install.
      await execute('warm XCTest driver', 'maestro', ['--device', udid, 'hierarchy'], { timeout: 180000, log: `${evidence}/setup-${attempt}-driver.log` });
      await execute('seed receipt photo', 'xcrun', ['simctl', 'addmedia', udid, imagePath], { timeout: 60000 });
      await perform('reset fixture', remaining => resetFixture('/__reset', { token, body: { preset: 'success', phase: `initial-${attempt}` }, signal, timeout: Math.min(5000, remaining) }));
      // A new device has no previous installation to terminate or uninstall.
      await execute('install application', 'xcrun', ['simctl', 'install', udid, appPath], { timeout: 120000 });
      await execute('launch application', 'xcrun', ['simctl', 'launch', udid, APP_ID], { timeout: 60000 });
      await execute('initial screenshot', 'xcrun', ['simctl', 'io', udid, 'screenshot', `${evidence}/initial.png`], { timeout: 30000 });
      await writeFile(`${evidence}/simulator.json`, JSON.stringify({ udid, runtime, model: 'iPhone 17', setupAttempt: attempt }));
      record.status = 'success';
      await writeFile(`${evidence}/setup-attempts.json`, JSON.stringify(attempts, null, 2));
      return udid;
    } catch (error) {
      record.status = 'failure';
      record.error = error.message;
      await writeFile(`${evidence}/setup-attempts.json`, JSON.stringify(attempts, null, 2));
      if (udid) {
        if (!signal?.aborted) await cleanupRun('xcrun', ['simctl', 'io', udid, 'screenshot', path.join(evidence, `setup-${attempt}-failed.png`)], { timeout: 3000, killGraceMs: 100, allowFailure: true }).catch(() => {});
        for (const action of ['shutdown', 'delete']) {
          await cleanupRun('xcrun', ['simctl', action, udid], { timeout: signal?.aborted ? 1500 : 3000, killGraceMs: 100, allowFailure: true }).catch(() => {});
        }
      }
      if (signal?.aborted || attempt === 2 || !/timed out|timeout/i.test(error.message)) throw error;
      console.log(`Simulator setup timeout at ${record.stage}; retrying once on a new isolated device.`);
    }
  }
}
