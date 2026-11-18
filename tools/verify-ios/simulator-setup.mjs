import { appendFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { APP_ID } from './policy.mjs';
import { fixtureControl } from './fixture-control.mjs';
import { cleanEnv } from './process.mjs';

// Only infrastructure provisioning is retried. No app assertions or test flows
// run here, and every failed attempt discards its own isolated device.
export async function provisionSimulator({ run, cleanupRun = run, evidence, runtime, runId, appPath, imagePath, token,
  signal, resetFixture = fixtureControl, now = Date.now, collectDiagnostics = false }) {
  const attempts = [];
  for (let attempt = 1; attempt <= 2; attempt++) {
    // Hosted iOS 26 cold boots can spend over three minutes in data migration.
    // Preserve room for the full driver startup allowance after that migration.
    const deadline = now() + 12 * 60_000;
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
      // Initialize fixture control before cold simulator services contend for CPU.
      await perform('reset fixture', remaining => resetFixture('/__reset', { token, body: { preset: 'success', phase: `initial-${attempt}` }, signal, timeout: Math.min(30000, remaining) }));
      udid = (await execute('create device', 'xcrun', ['simctl', 'create', `Verify-${runId}-${attempt}`, 'com.apple.CoreSimulator.SimDeviceType.iPhone-17', runtime])).output.trim();
      record.udid = udid;
      await execute('boot device', 'xcrun', ['simctl', 'boot', udid]);
      await execute('wait for boot', 'xcrun', ['simctl', 'bootstatus', udid, '-b'], { timeout: 360000, log: `${evidence}/setup-${attempt}-boot.log` });
      // A new device has no previous installation to terminate or uninstall.
      await execute('install application', 'xcrun', ['simctl', 'install', udid, appPath], { timeout: 120000 });
      await execute('launch application', 'xcrun', ['simctl', 'launch', udid, APP_ID], { timeout: 180000 });
      // Warm against the app's small UI. SpringBoard hierarchy traversal can
      // stall on hosted simulators even after the XCTest server is reachable.
      await execute('warm XCTest driver', 'maestro', ['--verbose', '--device', udid, 'hierarchy'], { timeout: 300000,
        env: { ...cleanEnv(), MAESTRO_DRIVER_STARTUP_TIMEOUT: '240000', XDG_STATE_HOME: `${evidence}/setup-${attempt}-state` },
        log: `${evidence}/setup-${attempt}-driver.log` });
      await execute('seed receipt photo', 'xcrun', ['simctl', 'addmedia', udid, imagePath], { timeout: 180000 });
      await execute('initial screenshot', 'xcrun', ['simctl', 'io', udid, 'screenshot', `${evidence}/initial.png`], { timeout: 30000 });
      await writeFile(`${evidence}/simulator.json`, JSON.stringify({ udid, runtime, model: 'iPhone 17', setupAttempt: attempt }));
      record.status = 'success';
      await writeFile(`${evidence}/setup-attempts.json`, JSON.stringify(attempts, null, 2));
      return udid;
    } catch (error) {
      record.status = 'failure';
      record.error = error.message;
      await writeFile(`${evidence}/setup-attempts.json`, JSON.stringify(attempts, null, 2));
      if (collectDiagnostics && !signal?.aborted) {
        await Promise.allSettled([
          ['processes', 'ps', ['-axo', 'pid,ppid,stat,pcpu,pmem,rss,comm']],
          ['memory', 'vm_stat', []],
          ['swap', 'sysctl', ['vm.swapusage']],
          ['disk', 'df', ['-h']],
        ].map(([name, command, args]) => cleanupRun(command, args, {
          timeout: 1000, killGraceMs: 100, allowFailure: true, log: path.join(evidence, `setup-${attempt}-host-${name}.log`),
        })));
      }
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
