import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';

export const cleanEnv = () => Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  !/TOKEN|SECRET|PASSWORD|ACTIONS_|GITHUB_|GH_|COPILOT_|NODE_OPTIONS|BASH_ENV/.test(key)));

// No shell interpolation. Kill the entire process group on timeout, so Maestro,
// Java, and Copilot child processes cannot outlive their allotted time.
export function run(command, args, { timeout = 120000, log, env = cleanEnv(), cwd, allowFailure = false, signal, killGraceMs = 1000 } = {}) {
  if (signal?.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    const stream = log ? createWriteStream(log, { flags: 'a' }) : null;
    let output = '', timedOut = false, cancelled = false, termination;
    const consume = data => { stream?.write(data); if (output.length < 2_000_000) output += data.toString(); };
    child.stdout.on('data', consume); child.stderr.on('data', consume);
    const groupSignal = signal => {
      if (!child.pid) return false;
      try { process.kill(-child.pid, signal); return true; } catch { return false; }
    };
    const stop = () => {
      if (termination) return termination;
      if (!groupSignal('SIGTERM')) return Promise.resolve();
      // Parent exit does not imply its descendants exited. Wait for the entire
      // group and escalate even when a stubborn grandchild closed its stdio.
      termination = new Promise(resolve => {
        const finished = () => { clearTimeout(force); clearInterval(poll); resolve(); };
        const force = setTimeout(() => { groupSignal('SIGKILL'); finished(); }, killGraceMs);
        const poll = setInterval(() => { if (!groupSignal(0)) finished(); }, 20);
      });
      return termination;
    };
    const cancel = () => { cancelled = true; void stop(); };
    const timer = setTimeout(() => {
      timedOut = true; void stop();
    }, timeout);
    for (const name of ['SIGINT', 'SIGTERM']) process.on(name, cancel);
    signal?.addEventListener('abort', cancel, { once: true });
    const cleanup = () => {
      clearTimeout(timer);
      for (const name of ['SIGINT', 'SIGTERM']) process.off(name, cancel);
      signal?.removeEventListener('abort', cancel);
      stream?.end();
    };
    child.once('error', error => { cleanup(); reject(error); });
    child.once('close', async code => {
      clearTimeout(timer);
      await stop();
      cleanup();
      const result = { code, output, timedOut, cancelled };
      if (!allowFailure && (code !== 0 || timedOut || cancelled)) reject(new Error(`${command} ${args[0] || ''} ${cancelled ? 'cancelled' : timedOut ? 'timed out' : `exited ${code}`}: ${output.slice(-2000)}`));
      else resolve(result);
    });
  });
}

export function stopProcess(child, { signal = 'SIGTERM', timeout = 1000 } = {}) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise(resolve => {
    const done = () => { clearTimeout(timer); child.off('close', done); child.off('error', done); resolve(); };
    const timer = setTimeout(() => { child.kill('SIGKILL'); done(); }, timeout);
    child.once('close', done); child.once('error', done);
    if (!child.kill(signal)) done();
  });
}

export async function resetScenario({ udid, appPath, appId, fixture, phase, token, signal }) {
  const response = await fetch('http://localhost:8765/__reset', { method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ preset: fixture, phase }),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(5000)]) : AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error('Could not reset fixture backend');
  await run('xcrun', ['simctl', 'terminate', udid, appId], { allowFailure: true, signal });
  await run('xcrun', ['simctl', 'uninstall', udid, appId], { allowFailure: true, signal });
  await run('xcrun', ['simctl', 'install', udid, appPath], { signal });
  await run('xcrun', ['simctl', 'launch', udid, appId], { signal });
}
