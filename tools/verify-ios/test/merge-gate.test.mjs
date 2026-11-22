import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateGate, refreshGate } from '../merge-gate.mjs';
import { marker, finalMarker, externalId } from '../request-marker.mjs';

function fixture() {
  const pr = {
    number: 69,
    state: 'open',
    head: { sha: 'head' },
    base: { ref: 'main', sha: 'base' },
    changed_files: 1,
  };
  const request = {
    version: 1,
    pr: 69,
    headSha: 'head',
    baseSha: 'base',
    trustedSha: 'trusted',
    repository: 'owner/repo',
    runId: 4,
    commentId: 3,
    checkId: 5,
    attempt: 1,
  };
  const run = {
    event: 'issue_comment',
    path: '.github/workflows/verify-ios.yml',
    head_repository: { full_name: 'owner/repo' },
    head_sha: 'trusted',
    status: 'completed',
    conclusion: 'success',
    run_attempt: 1,
    html_url: 'https://example.com/run',
  };
  const check = {
    head_sha: request.headSha,
    app: { slug: 'github-actions' },
    external_id: externalId(request),
    status: 'completed',
    conclusion: 'success',
    output: {
      title: 'PASS',
      summary: marker(request) + '\n' + finalMarker(request, 1) + '\nverdict',
    },
  };
  const data = (value) => async () => ({ data: value });
  const comments = [{ user: { login: 'github-actions[bot]' }, body: marker(request) }];
  const trees = {
    head: { tree: { sha: 'tree' } },
    empty: { parents: [{ sha: 'head' }], tree: { sha: 'tree' } },
  };
  const files = [{ filename: 'app/index.tsx' }];
  const github = {
    rest: {
      pulls: { get: data(pr), listFiles: 'files' },
      issues: { listComments: 'comments' },
      actions: { getWorkflowRun: data(run) },
      checks: { get: data(check) },
      git: { getCommit: async ({ commit_sha }) => ({ data: trees[commit_sha] }) },
    },
    paginate: async (method) => (method === 'files' ? files : comments),
  };
  const summaries = [];
  const gate = () =>
    evaluateGate({
      github,
      context: { repo: { owner: 'owner', repo: 'repo' }, payload: { pull_request: pr } },
      core: { summary: { addRaw: (message) => ({ write: async () => summaries.push(message) }) } },
    });
  return { gate, pr, request, run, check, comments, trees, files, summaries, github };
}

test('PR job accepts the original published check and approved simulator skip', async () => {
  const f = fixture();
  await f.gate();
  assert.match(f.summaries[0], /PASS for verified commit `head`/);
  f.check.output.title = 'SKIPPED';
  f.check.conclusion = 'neutral';
  await f.gate();
  assert.match(f.summaries[1], /SKIPPED/);
});

test('gate rejects missing, superseded, unfinished, mismatched and non-passing reports', async () => {
  for (const invalidate of [
    (f) => {
      f.comments[0].user.login = 'writer';
    },
    (f) => {
      f.run.run_attempt = 2;
    },
    (f) => {
      f.run.status = 'in_progress';
    },
    (f) => {
      f.run.path = '.github/workflows/other.yml';
    },
    (f) => {
      f.check.external_id = 'other';
    },
    (f) => {
      f.check.output.title = 'FAIL';
    },
    (f) => {
      f.check.conclusion = 'failure';
    },
    (f) => {
      f.check.app.slug = 'other';
    },
    (f) => {
      f.comments.push({ ...f.comments[0], body: marker({ ...f.request, checkId: 6, runId: 5 }) });
    },
  ]) {
    const f = fixture();
    invalidate(f);
    await assert.rejects(f.gate);
  }
});

test('empty child can reuse the identical verified tree while changed trees and newer failures block', async () => {
  const f = fixture();
  f.pr.head.sha = 'empty';
  await f.gate();
  f.trees.empty.tree.sha = 'changed';
  await assert.rejects(f.gate, /No iOS verdict/);
  f.trees.empty.tree.sha = 'tree';
  f.comments.push({
    ...f.comments[0],
    body: marker({ ...f.request, headSha: 'empty', checkId: 6 }),
  });
  await assert.rejects(f.gate);
});

test('an advancing main must preserve the scope of verification', async () => {
  const f = fixture();
  f.pr.base.sha = 'newBase';
  let mergeBase = 'common';
  f.github.rest.repos = {
    compareCommitsWithBasehead: async ({ basehead }) => ({
      data: { merge_base_commit: { sha: basehead.startsWith('base...') ? 'common' : mergeBase } },
    }),
  };
  await f.gate();
  mergeBase = 'changed';
  await assert.rejects(f.gate);
});

test('exempt PR passes even without a verification comment', async () => {
  const f = fixture();
  f.files[0].filename = 'README.md';
  f.comments.length = 0;
  await f.gate();
  assert.match(f.summaries[0], /exempt/);
});

test('refresh reruns only the newest PR gate for this head', async () => {
  const f = fixture();
  const reruns = [];
  f.github.paginate = async (_, params) => {
    assert.equal(params.workflow_id, 'verify-ios-applicability.yml');
    assert.equal(params.head_sha, 'head');
    return [
      [20, 69],
      [22, 70],
      [21, 69],
    ].map(([id, number]) => ({ id, pull_requests: [{ number }] }));
  };
  f.github.rest.actions.reRunWorkflow = async ({ run_id }) => reruns.push(run_id);
  await refreshGate(f.github, {}, f.pr);
  assert.deepEqual(reruns, [21]);
});
