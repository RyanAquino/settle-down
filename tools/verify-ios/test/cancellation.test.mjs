import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import net from 'node:net';
import { cleanupRuntime } from '../runner.mjs';

const runnerPath = fileURLToPath(new URL('../runner.mjs', import.meta.url));
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
const kill = pid => { try { process.kill(pid, 'SIGKILL'); } catch { /* already exited */ } };
async function waitFor(read, description, timeout = 5000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await read().catch(() => false);
    if (value) return value;
    await delay(20);
  }
  throw new Error(`Timed out waiting for ${description}`);
}

for (const signal of ['SIGINT', 'SIGTERM']) for (const stubborn of [false, true]) test(`runner persists ${signal} cancellation and stops ${stubborn ? 'stubborn descendants' : 'its child'}`, { timeout: 15000 }, async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'verify-cancel-'));
  await mkdir(`${directory}/bin`); await mkdir(`${directory}/request`);
  await writeFile(`${directory}/request/request.json`, JSON.stringify({ headSha: 'a'.repeat(40), baseSha: 'b'.repeat(40) }));
  // Stop before simulator setup: exercise the actual runner, using a real detached
  // subprocess that waits for a signal instead of executing Git.
  await writeFile(`${directory}/bin/git`, `#!${process.execPath}
import fs from 'node:fs';
import { spawn } from 'node:child_process';
if (${stubborn}) {
  const child = spawn(process.execPath, ['-e', "process.on('SIGTERM', () => {}); process.send('ready'); setInterval(() => {}, 1000);"], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  child.on('message', () => fs.writeFileSync(${JSON.stringify(`${directory}/ready.json`)}, JSON.stringify({ child: process.pid, descendant: child.pid })));
} else fs.writeFileSync(${JSON.stringify(`${directory}/ready.json`)}, JSON.stringify({ child: process.pid }));
setInterval(() => {}, 1000);
`, { mode: 0o755 });
  const runner = spawn(process.execPath, [runnerPath, directory, `${directory}/request`, `${directory}/unused.tar.gz`, `${directory}/evidence`],
    { env: { ...process.env, PATH: `${directory}/bin:${process.env.PATH}` }, detached: true, stdio: 'ignore' });
  const exit = once(runner, 'exit');
  let pids;
  t.after(async () => {
    kill(-runner.pid); if (pids) kill(-pids.child);
    await rm(directory, { recursive: true, force: true });
  });
  pids = await waitFor(async () => JSON.parse(await readFile(`${directory}/ready.json`, 'utf8')), 'child startup');
  runner.kill(signal);
  let timer;
  await Promise.race([exit, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Runner did not finish cancellation')), 8000); })])
    .finally(() => clearTimeout(timer));
  const result = JSON.parse(await readFile(`${directory}/evidence/result.json`, 'utf8'));
  assert.equal(result.verdict, 'CANCELLED');
  assert.match(await readFile(`${directory}/evidence/report.md`, 'utf8'), /CANCELLED/);
  await waitFor(async () => Object.values(pids).every(pid => !alive(pid)), 'child/descendant termination');
});

test('cleanup finalizes recording and closes resources even when the final screenshot hangs', { timeout: 10000 }, async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'verify-cleanup-'));
  await mkdir(`${directory}/bin`);
  const originalPath = process.env.PATH;
  await writeFile(`${directory}/bin/xcrun`, `#!${process.execPath}
import fs from 'node:fs';
fs.appendFileSync(${JSON.stringify(`${directory}/commands.jsonl`)}, JSON.stringify({ args: process.argv.slice(2), recordingFinalized: fs.existsSync(${JSON.stringify(`${directory}/video-finalized`)}) }) + '\\n');
if (process.argv.includes('screenshot')) {
  fs.writeFileSync(${JSON.stringify(`${directory}/screenshot.pid`)}, String(process.pid));
  process.on('SIGTERM', () => {});
  setInterval(() => {}, 1000);
}
`, { mode: 0o755 });
  process.env.PATH = `${directory}/bin:${originalPath}`;
  const video = spawn(process.execPath, ['-e', `
    process.on('SIGINT', () => setTimeout(() => { require('node:fs').writeFileSync(${JSON.stringify(`${directory}/video-finalized`)}, 'flushed'); process.exit(0); }, 3500));
    process.send('ready'); setInterval(() => {}, 1000);
  `], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  const simulatorLog = spawn(process.execPath, ['-e', "process.on('SIGTERM', () => {}); process.send('ready'); setInterval(() => {}, 1000);"],
    { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  const fixtureServer = http.createServer();
  let socket;
  t.after(async () => {
    process.env.PATH = originalPath;
    kill(video.pid); kill(simulatorLog.pid);
    try { kill(-Number(await readFile(`${directory}/screenshot.pid`, 'utf8'))); } catch { /* not started */ }
    socket?.destroy(); fixtureServer.closeAllConnections(); fixtureServer.close();
    await rm(directory, { recursive: true, force: true });
  });
  await Promise.all([once(video, 'message'), once(simulatorLog, 'message')]);
  fixtureServer.listen(0, '127.0.0.1');
  await once(fixtureServer, 'listening');
  const received = once(fixtureServer, 'request');
  socket = net.createConnection(fixtureServer.address().port, '127.0.0.1');
  socket.on('error', () => {});
  await once(socket, 'connect');
  socket.write('GET /hold HTTP/1.1\r\nHost: localhost\r\n\r\n');
  await received; // Keep an active HTTP request open until cleanup closes it.
  const cancelledAt = Date.now();
  await cleanupRuntime({ udid: 'test-device', video, simulatorLog, fixtureServer, evidence: directory, cancelledAt: () => cancelledAt });
  assert.ok(Date.now() - cancelledAt < 6000, 'Cleanup exceeded cancellation grace');
  assert.equal(await readFile(`${directory}/video-finalized`, 'utf8'), 'flushed');
  assert.equal(fixtureServer.listening, false);
  const screenshotPid = Number(await readFile(`${directory}/screenshot.pid`, 'utf8'));
  await waitFor(async () => !alive(screenshotPid) && !alive(simulatorLog.pid) && !alive(video.pid) && socket.destroyed, 'resource teardown');
  const commands = (await readFile(`${directory}/commands.jsonl`, 'utf8')).trim().split('\n').map(JSON.parse);
  assert.ok(commands.some(({ args, recordingFinalized }) => args.includes('shutdown') && recordingFinalized), 'Simulator shutdown must wait for recording finalization');
  assert.ok(commands.some(({ args }) => args.includes('delete')));
});
