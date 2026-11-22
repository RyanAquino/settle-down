import { Buffer } from 'node:buffer';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, symlink, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { cleanEnv } from '../process.mjs';
import { RESULT_LIMIT_BYTES } from '../paging.mjs';

test('the MCP adapter confines source reads and writes and rejects unsafe actions before execution', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'verify-mcp-'));
  const source = `${directory}/source`,
    evidence = `${directory}/evidence`;
  await mkdir(source);
  await mkdir(`${evidence}/exploration`, { recursive: true });
  await writeFile(`${source}/screen.tsx`, 'export const label = "Synthetic screen";');
  await symlink('screen.tsx', `${source}/alias.tsx`);
  await writeFile(`${source}/oversized.md`, 'x'.repeat(160001));
  const sourceFiles = ['screen.tsx', 'escape.ts', 'large.tsx', 'alias.tsx', 'oversized.md'];
  await writeFile(`${directory}/outside.ts`, 'Do not read');
  await symlink(`${directory}/outside.ts`, `${source}/escape.ts`);
  // Large enough that one unpaged result would exceed Copilot's 20,480-byte
  // tool-output limit and be hidden from the model behind a temp-file preview.
  const largeSource = Array.from(
    { length: 1500 },
    (_, i) => `export const line${i} = "Synthetic large screen ${i}";`,
  ).join('\n');
  await writeFile(`${source}/large.tsx`, largeSource);
  const largeDiff = `diff --git a/large.tsx b/large.tsx\n${largeSource
    .split('\n')
    .map((l) => `+${l}`)
    .join('\n')}\n`;
  await writeFile(
    `${evidence}/context.json`,
    JSON.stringify({
      request: { pr: 7, headSha: 'a'.repeat(40), baseSha: 'b'.repeat(40) },
      pr: { title: 'Synthetic', body: 'x'.repeat(30000) },
      sourceFiles,
      changedFiles: ['screen.tsx', 'large.tsx'],
      diffs: [
        {
          file: 'screen.tsx',
          additions: 1,
          deletions: 0,
          truncated: false,
          text: 'diff --git a/screen.tsx b/screen.tsx\n+export const label = "Synthetic screen";\n',
        },
        { file: 'large.tsx', additions: 1500, deletions: 0, truncated: false, text: largeDiff },
      ],
      diffTruncated: false,
      fixtures: { presets: ['success'] },
    }),
  );
  const client = new Client({ name: 'test', version: '1' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [fileURLToPath(new URL('../agent-tools.mjs', import.meta.url))],
    env: { ...cleanEnv(), VERIFY_SOURCE: source, VERIFY_EVIDENCE: evidence, VERIFY_UDID: 'unused' },
    stderr: 'pipe',
  });
  t.after(async () => {
    await client.close();
    await rm(directory, { recursive: true, force: true });
  });
  await client.connect(transport);
  const tools = await client.listTools();
  assert.deepEqual(
    tools.tools.map((x) => x.name).sort(),
    [
      'execute_flow',
      'fixture_requests',
      'get_context',
      'get_diff',
      'get_regression',
      'inspect_screen',
      'read_source',
      'reset_scenario',
      'screenshot',
      'submit_plan',
    ].sort(),
  );
  const call = (name, args = {}) => client.callTool({ name, arguments: args });
  const bytes = (result) =>
    result.content.reduce((n, block) => n + Buffer.byteLength(block.text || ''), 0);
  const context = await call('get_context');
  assert.ok(bytes(context) <= RESULT_LIMIT_BYTES);
  const summary = JSON.parse(context.content[0].text);
  assert.deepEqual(summary.sourceFiles, sourceFiles);
  assert.equal(summary.pr.bodyTruncated, true);
  const large = summary.changedFiles.find((f) => f.file === 'large.tsx');
  assert.ok(large.diffPages > 1);
  assert.equal(large.readable, true);
  assert.match(
    (await call('read_source', { file: 'screen.tsx' })).content[1].text,
    /Synthetic screen/,
  );
  // Every page of a large file and diff fits the limit and reassembles exactly.
  for (const [name, args, expected] of [
    ['read_source', { file: 'large.tsx' }, largeSource],
    ['get_diff', { file: 'large.tsx' }, largeDiff],
  ]) {
    const first = await call(name, args);
    const { pages, startLine } = JSON.parse(first.content[0].text);
    assert.ok(pages > 1);
    assert.equal(startLine, 1);
    let text = '';
    for (let page = 1; page <= pages; page++) {
      const result = await call(name, { ...args, page });
      assert.notEqual(result.isError, true);
      assert.ok(bytes(result) <= RESULT_LIMIT_BYTES);
      text += result.content[1].text;
    }
    assert.equal(text, expected);
    assert.equal((await call(name, { ...args, page: pages + 1 })).isError, true);
  }
  assert.match(
    (await call('get_diff', { file: 'screen.tsx' })).content[1].text,
    /Synthetic screen/,
  );
  assert.equal((await call('get_diff', { file: 'missing.tsx' })).isError, true);
  assert.equal((await call('read_source', { file: '../outside.ts' })).isError, true);
  assert.equal((await call('read_source', { file: 'escape.ts' })).isError, true);
  for (const file of ['alias.tsx', 'oversized.md']) {
    assert.equal((await call('read_source', { file })).isError, true);
  }
  assert.equal(
    (await call('execute_flow', { yaml: 'appId: ${APP_ID}\n---\n- runScript: evil.js' })).isError,
    true,
  );
  assert.equal(
    (
      await call('submit_plan', {
        disposition: 'ready',
        rationale: 'Nothing has actually executed yet.',
        limitations: [],
        scenarios: [],
      })
    ).isError,
    true,
  );
  assert.notEqual(
    (
      await call('submit_plan', {
        disposition: 'skipped',
        rationale: 'The PR changes documentation without changing any iOS UI.',
        limitations: [],
        scenarios: [],
      })
    ).isError,
    true,
  );
  const plan = JSON.parse(await readFile(`${evidence}/plan.json`, 'utf8'));
  assert.equal(plan.disposition, 'skipped');
  const log = (await readFile(`${evidence}/tool-calls.jsonl`, 'utf8'))
    .trim()
    .split('\n')
    .map(JSON.parse);
  assert.equal(log.filter((c) => !c.ok).length, 9);
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

test('finalization budget refuses more exploration but still accepts a blocked plan', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'verify-budget-mcp-'));
  const evidence = `${directory}/evidence`;
  await mkdir(evidence);
  const client = new Client({ name: 'budget-test', version: '1' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [fileURLToPath(new URL('../agent-tools.mjs', import.meta.url))],
    env: {
      ...cleanEnv(),
      VERIFY_SOURCE: directory,
      VERIFY_EVIDENCE: evidence,
      VERIFY_UDID: 'unused',
      VERIFY_AGENT_DEADLINE: String(Date.now() + 30_000),
    },
    stderr: 'pipe',
  });
  t.after(async () => {
    await client.close();
    await rm(directory, { recursive: true, force: true });
  });
  await client.connect(transport);
  const rejected = await client.callTool({
    name: 'reset_scenario',
    arguments: { fixture: 'success' },
  });
  assert.equal(rejected.isError, true);
  assert.match(rejected.content[0].text, /reserve time/);
  const saved = await client.callTool({
    name: 'submit_plan',
    arguments: {
      disposition: 'blocked',
      rationale: 'Deadline reached before coverage could be completed.',
      limitations: ['Camera permission recovery remains unverified.'],
      scenarios: [],
    },
  });
  assert.notEqual(saved.isError, true);
  assert.equal(JSON.parse(await readFile(`${evidence}/plan.json`, 'utf8')).disposition, 'blocked');
});
