import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';

export const cleanEnv = () => Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  !/TOKEN|SECRET|PASSWORD|ACTIONS_|GITHUB_|GH_|COPILOT_|NODE_OPTIONS|BASH_ENV/.test(key)));

// No shell interpolation. Kill the entire process group on timeout, so Maestro,
// Java, and Copilot child processes cannot outlive their allotted time.
export function run(command, args, { timeout = 120000, log, env = cleanEnv(), cwd, allowFailure = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    const stream = log ? createWriteStream(log, { flags: 'a' }) : null;
    let output = '', timedOut = false;
    const consume = data => { stream?.write(data); if (output.length < 2_000_000) output += data.toString(); };
    child.stdout.on('data', consume); child.stderr.on('data', consume);
    const stop = () => { try { process.kill(-child.pid, 'SIGTERM'); } catch { /* already exited */ } };
    let force;
    const timer = setTimeout(() => {
      timedOut = true; stop();
      force = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already exited */ } }, 3000);
    }, timeout);
    process.once('SIGTERM', stop);
    child.once('error', error => { clearTimeout(timer); stream?.end(); process.off('SIGTERM', stop); reject(error); });
    child.once('close', code => {
      stop(); // Also terminate MCP descendants after their parent exits normally.
      clearTimeout(timer); clearTimeout(force); process.off('SIGTERM', stop); stream?.end();
      const result = { code, output, timedOut };
      if (!allowFailure && (code !== 0 || timedOut)) reject(new Error(`${command} ${args[0] || ''} ${timedOut ? 'timed out' : `exited ${code}`}: ${output.slice(-2000)}`));
      else resolve(result);
    });
  });
}

export async function resetScenario({ udid, appPath, appId, fixture, phase, token }) {
  const response = await fetch('http://localhost:8765/__reset', { method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ preset: fixture, phase }), signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error('Could not reset fixture backend');
  await run('xcrun', ['simctl', 'terminate', udid, appId], { allowFailure: true });
  await run('xcrun', ['simctl', 'uninstall', udid, appId], { allowFailure: true });
  await run('xcrun', ['simctl', 'install', udid, appPath]);
  await run('xcrun', ['simctl', 'launch', udid, appId]);
}
