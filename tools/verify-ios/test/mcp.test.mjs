import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, symlink, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { cleanEnv } from '../process.mjs';

test('the MCP adapter confines source reads and writes and rejects unsafe actions before execution', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'verify-mcp-'));
  const source = `${directory}/source`, evidence = `${directory}/evidence`;
  await mkdir(source); await mkdir(`${evidence}/exploration`, { recursive: true });
  await writeFile(`${source}/screen.tsx`, 'export const label = "Synthetic screen";');
  await writeFile(`${directory}/outside.ts`, 'Do not read');
  await symlink(`${directory}/outside.ts`, `${source}/escape.ts`);
  await writeFile(`${evidence}/context.json`, JSON.stringify({ sourceFiles: ['screen.tsx', 'escape.ts'], changedFiles: ['screen.tsx'] }));
  const client = new Client({ name: 'test', version: '1' });
  const transport = new StdioClientTransport({ command: process.execPath,
    args: [fileURLToPath(new URL('../agent-tools.mjs', import.meta.url))],
    env: { ...cleanEnv(), VERIFY_SOURCE: source, VERIFY_EVIDENCE: evidence, VERIFY_UDID: 'unused' }, stderr: 'pipe',
  });
  t.after(async () => { await client.close(); await rm(directory, { recursive: true, force: true }); });
  await client.connect(transport);
  const tools = await client.listTools();
  assert.deepEqual(tools.tools.map(x => x.name).sort(), ['execute_flow', 'fixture_requests', 'get_context', 'inspect_screen', 'read_source', 'reset_scenario', 'screenshot', 'submit_plan'].sort());
  const call = (name, args = {}) => client.callTool({ name, arguments: args });
  assert.match((await call('read_source', { file: 'screen.tsx' })).content[0].text, /Synthetic screen/);
  assert.equal((await call('read_source', { file: '../outside.ts' })).isError, true);
  assert.equal((await call('read_source', { file: 'escape.ts' })).isError, true);
  assert.equal((await call('execute_flow', { yaml: 'appId: ${APP_ID}\n---\n- runScript: evil.js' })).isError, true);
  assert.equal((await call('submit_plan', { disposition: 'ready', rationale: 'Nothing has actually executed yet.', limitations: [], scenarios: [] })).isError, true);
  assert.notEqual((await call('submit_plan', { disposition: 'skipped', rationale: 'The PR changes documentation without changing any iOS UI.', limitations: [], scenarios: [] })).isError, true);
  const plan = JSON.parse(await readFile(`${evidence}/plan.json`, 'utf8'));
  assert.equal(plan.disposition, 'skipped');
  const log = (await readFile(`${evidence}/tool-calls.jsonl`, 'utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(log.filter(c => !c.ok).length, 4);
});

test('subprocess environment does not contain GitHub, Copilot, or fixture credentials', () => {
  process.env.VERIFY_FIXTURE_TOKEN = 'synthetic';
  process.env.COPILOT_GITHUB_TOKEN = 'synthetic';
  process.env.GITHUB_TOKEN = 'synthetic';
  const env = cleanEnv();
  assert.equal(env.GITHUB_TOKEN, undefined);
  assert.equal(env.COPILOT_GITHUB_TOKEN, undefined);
  assert.equal(env.VERIFY_FIXTURE_TOKEN, undefined);
  assert.ok(env.PATH);
  delete process.env.VERIFY_FIXTURE_TOKEN;
  delete process.env.COPILOT_GITHUB_TOKEN;
  delete process.env.GITHUB_TOKEN;
});
