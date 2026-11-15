import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { isCommand, canVerify, isEligible, admit, marker, renderReport, publish } from '../github.mjs';

const sha = 'a'.repeat(40), base = 'b'.repeat(40);
const event = () => ({ action: 'created', issue: { number: 12, pull_request: {} }, comment: { id: 5, body: ' /verify\n', user: { type: 'User', login: 'writer' } } });
test('only exact newly created human PR commands are admitted', () => {
  assert.equal(isCommand(event()), true);
  for (const body of ['/verify now', 'please /verify', '/verify\nother', '`/verify`', '/Verify']) {
    assert.equal(isCommand({ ...event(), comment: { ...event().comment, body } }), false);
  }
  assert.equal(isCommand({ ...event(), action: 'edited' }), false);
  assert.equal(isCommand({ ...event(), issue: {} }), false);
  assert.equal(isCommand({ ...event(), comment: { ...event().comment, user: { type: 'Bot' } } }), false);
  for (const p of ['write', 'maintain', 'admin']) assert.equal(canVerify(p), true);
  for (const p of ['read', 'triage', 'none']) assert.equal(canVerify(p), false);
  assert.equal(isEligible({ state: 'open', head: { repo: { full_name: 'owner/app' } } }, 'owner/app'), true);
  assert.equal(isEligible({ state: 'open', head: { repo: { full_name: 'fork/app' } } }, 'owner/app'), false);
});

function harness() {
  const writes = [], outputs = {};
  const repo = { owner: 'owner', repo: 'app' };
  const pr = { number: 12, state: 'open', head: { sha, repo: { full_name: 'owner/app' } }, base: { sha: base }, title: 'PR', body: 'Change' };
  const rest = {
    repos: { getCollaboratorPermissionLevel: async () => ({ data: { permission: 'write' } }) },
    pulls: { get: async () => ({ data: pr }) },
    checks: { listForRef: 'checks', create: async x => { writes.push(x); return { data: { id: 30 } }; }, update: async x => writes.push(x) },
    issues: { createComment: async x => { writes.push(x); return { data: { id: 40 } }; }, listComments: 'comments', listCommentsForRepo: 'all-comments', updateComment: async x => writes.push(x) },
    actions: { getWorkflowRun: async () => ({ data: { status: 'in_progress', html_url: 'https://github.com/run' } }), listWorkflowRunArtifacts: 'artifacts' },
  };
  const github = { rest, paginate: async () => [] };
  const context = { repo, payload: event(), sha: base, runId: 100, serverUrl: 'https://github.com' };
  const core = { notice() {}, warning() {}, setOutput: (k,v) => { outputs[k] = v; }, summary: { addRaw() { return this; }, async write() {} } };
  return { github, context, core, writes, outputs, pr };
}
test('admission captures PR head rather than the workflow SHA', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'verify-test-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const h = harness(); process.env.GITHUB_RUN_ATTEMPT = '1';
  await admit({ ...h, outputDir: directory });
  const request = JSON.parse(await readFile(`${directory}/request.json`, 'utf8'));
  assert.equal(request.headSha, sha); assert.equal(request.trustedSha, base);
  assert.equal(h.outputs.accepted, 'true'); assert.equal(h.writes[0].head_sha, sha);
});
test('unauthorized and duplicate requests never start work or cancel runs', async () => {
  const unauthorized = harness();
  unauthorized.github.rest.repos.getCollaboratorPermissionLevel = async () => ({ data: { permission: 'read' } });
  await admit({ ...unauthorized, outputDir: '/not-used' });
  assert.equal(unauthorized.writes.length, 0); assert.equal(unauthorized.outputs.accepted, undefined);
  const duplicate = harness();
  duplicate.github.paginate = async () => [{ status: 'in_progress', external_id: 'verify-ios:90:1:4', app: { slug: 'github-actions' } }];
  await admit({ ...duplicate, outputDir: '/not-used' });
  assert.equal(duplicate.outputs.accepted, undefined);
  assert.match(duplicate.writes[0].body, /already running/);
});
test('completion recovers cancellation metadata from a bot marker', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'verify-test-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const h = harness();
  const request = { version: 1, repository: 'owner/app', pr: 12, headSha: sha, runId: 100, attempt: 1, commentId: 5, checkId: 30 };
  h.context.payload = { workflow_run: { id: 100, run_attempt: 1, event: 'issue_comment', path: '.github/workflows/verify-ios.yml',
    head_repository: { full_name: 'owner/app' }, conclusion: 'cancelled', created_at: '2026-01-01', html_url: 'https://github.com/run' } };
  h.github.rest.checks.get = async () => ({ data: { external_id: 'verify-ios:100:1:5', head_sha: sha, app: { slug: 'github-actions' } } });
  h.github.paginate = async method => method === 'all-comments'
    ? [{ id: 40, user: { login: 'github-actions[bot]' }, body: marker(request) }] : [];
  await publish({ ...h, directory });
  assert.equal(h.writes[0].conclusion, 'cancelled');
  assert.match(h.writes[1].body, /CANCELLED/);
});
test('report labels stale results and escapes mentions and markup', () => {
  const request = { headSha: sha };
  const report = renderReport(request, { rationale: '<script>@someone</script>', scenarios: [] }, 'PASS', true, 'https://github.com/run', []);
  assert.match(report, /Stale/); assert.ok(!report.includes('<script>')); assert.ok(!report.includes('@someone'));
});
test('a build failure produces BLOCKED even without test evidence', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'verify-test-')); t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(`${directory}/request`);
  const h = harness();
  const request = { version: 1, repository: 'owner/app', pr: 12, headSha: sha, runId: 100, attempt: 1, commentId: 5, checkId: 30 };
  await writeFile(`${directory}/request/request.json`, JSON.stringify(request));
  h.context.payload = { workflow_run: { id: 100, run_attempt: 1, event: 'issue_comment', path: '.github/workflows/verify-ios.yml', head_repository: { full_name: 'owner/app' }, conclusion: 'failure', html_url: 'https://github.com/run' } };
  h.github.rest.checks.get = async () => ({ data: { external_id: 'verify-ios:100:1:5', head_sha: sha, app: { slug: 'github-actions' } } });
  await publish({ ...h, directory });
  assert.equal(h.writes[0].conclusion, 'failure'); assert.match(h.writes[1].body, /BLOCKED/);
});
