import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import { isExempt } from '../applicability.mjs';
import path from 'node:path';
import {
  isCommand,
  canVerify,
  isEligible,
  admit,
  marker,
  renderReport,
  publish,
  selectArtifacts,
} from '../github.mjs';

const sha = 'a'.repeat(40),
  base = 'b'.repeat(40);
const event = () => ({
  action: 'created',
  issue: { number: 12, pull_request: {} },
  comment: { id: 5, body: ' /verify\n', user: { type: 'User', login: 'writer' } },
});
test('only exact newly created human PR commands are admitted', () => {
  assert.equal(isCommand(event()), true);
  for (const body of ['/verify now', 'please /verify', '/verify\nother', '`/verify`', '/Verify']) {
    assert.equal(isCommand({ ...event(), comment: { ...event().comment, body } }), false);
  }
  assert.equal(isCommand({ ...event(), action: 'edited' }), false);
  assert.equal(isCommand({ ...event(), issue: {} }), false);
  assert.equal(
    isCommand({ ...event(), comment: { ...event().comment, user: { type: 'Bot' } } }),
    false,
  );
  for (const p of ['write', 'maintain', 'admin']) assert.equal(canVerify(p), true);
  for (const p of ['read', 'triage', 'none']) assert.equal(canVerify(p), false);
  assert.equal(
    isEligible({ state: 'open', head: { repo: { full_name: 'owner/app' } } }, 'owner/app'),
    true,
  );
  assert.equal(
    isEligible({ state: 'open', head: { repo: { full_name: 'fork/app' } } }, 'owner/app'),
    false,
  );
});

function harness() {
  const writes = [],
    outputs = {},
    comments = [],
    files = [{ filename: 'app/index.tsx' }];
  const repo = { owner: 'owner', repo: 'app' };
  const pr = {
    number: 12,
    state: 'open',
    head: { sha, repo: { full_name: 'owner/app' } },
    base: { sha: base, ref: 'main' },
    changed_files: files.length,
    title: 'PR',
    body: 'Change',
  };
  const rest = {
    repos: { getCollaboratorPermissionLevel: async () => ({ data: { permission: 'write' } }) },
    pulls: { get: async () => ({ data: pr }), listFiles: 'files' },
    checks: {
      listForRef: 'checks',
      create: async (x) => {
        writes.push(x);
        return { data: { id: 30 } };
      },
      update: async (x) => writes.push(x),
    },
    issues: {
      createComment: async (x) => {
        writes.push(x);
        const comment = {
          id: 41 + comments.length,
          user: { login: 'github-actions[bot]' },
          body: x.body,
        };
        comments.push(comment);
        return { data: comment };
      },
      listComments: 'comments',
      listCommentsForRepo: 'all-comments',
      updateComment: async (x) => {
        writes.push(x);
        const comment = comments.find((c) => c.id === x.comment_id) || { id: x.comment_id };
        comment.body = x.body;
        return { data: comment };
      },
    },
    actions: {
      getWorkflowRun: async () => ({
        data: { status: 'in_progress', html_url: 'https://github.com/run' },
      }),
      listWorkflowRunArtifacts: 'artifacts',
    },
  };
  const github = {
    rest,
    paginate: async (method) => {
      if (method === 'files') return files;
      return ['comments', 'all-comments'].includes(method) ? comments : [];
    },
  };
  const context = {
    repo,
    payload: event(),
    sha: base,
    runId: 100,
    serverUrl: 'https://github.com',
  };
  const core = {
    notice() {},
    warning() {},
    setOutput: (k, v) => {
      outputs[k] = v;
    },
    summary: {
      addRaw() {
        return this;
      },
      async write() {},
    },
  };
  function setFiles(...changes) {
    files.splice(
      0,
      files.length,
      ...changes.map((file) => (typeof file === 'string' ? { filename: file } : file)),
    );
    pr.changed_files = files.length;
  }
  return { github, context, core, writes, outputs, pr, comments, setFiles };
}
test('docs, workflows, and verifier-only changes remain exempt after a PR title edit', async () => {
  const h = harness();
  h.context.payload = {
    action: 'edited',
    changes: { title: { from: 'Old title' } },
    pull_request: h.pr,
  };
  h.setFiles(
    'README.md',
    'docs/ci.md',
    'components/README.md',
    '.github/workflows/verify-ios.yml',
    'tools/verify-ios/github.mjs',
  );

  assert.equal(await isExempt(h), true);
  assert.deepEqual(h.writes, []);
});

test('any app, asset, native, or build change retains verification', async () => {
  for (const file of [
    'app/index.tsx',
    'components/camera-session.tsx',
    'utils/receipt.ts',
    'assets/images/icon.png',
    'ios/Podfile',
    'package-lock.json',
    'app.config.ts',
    'metro.config.cjs',
    { filename: 'docs/old-screen.md', previous_filename: 'app/old-screen.tsx' },
  ]) {
    const h = harness();
    h.context.payload = { pull_request: h.pr };
    h.setFiles('docs/ci.md', '.github/workflows/native.yml', file);
    assert.equal(await isExempt(h), false, JSON.stringify(file));
  }
});

test('an incomplete file list or a changed PR head cannot grant an exemption', async () => {
  for (const changedCount of [2, 3001]) {
    const h = harness();
    h.setFiles('README.md');
    h.pr.changed_files = changedCount;
    h.context.payload = { pull_request: h.pr };
    assert.equal(await isExempt(h), false);
  }

  const h = harness();
  h.context.payload = { pull_request: h.pr };
  h.github.paginate = async () => {
    h.github.rest.pulls.get = async () => ({
      data: { ...h.pr, head: { sha: 'c'.repeat(40) } },
    });
    return [{ filename: 'README.md' }];
  };
  assert.equal(await isExempt(h), false);
});

test('a /verify comment on an exempt PR does not start a simulator build', async () => {
  const h = harness();
  h.setFiles('.github/workflows/verify-ios.yml');
  await admit({ ...h, outputDir: '/not-used' });
  assert.deepEqual(h.writes, []);
  assert.equal(h.outputs.accepted, undefined);
});

test('admission captures PR head rather than the workflow SHA', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'verify-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const h = harness();
  process.env.GITHUB_RUN_ATTEMPT = '1';
  await admit({ ...h, outputDir: directory });
  const request = JSON.parse(await readFile(`${directory}/request.json`, 'utf8'));
  assert.equal(request.headSha, sha);
  assert.equal(request.trustedSha, base);
  assert.equal(h.outputs.accepted, 'true');
  assert.equal(h.writes[0].head_sha, sha);
});
test('unauthorized and duplicate requests never start work or cancel runs', async () => {
  const unauthorized = harness();
  unauthorized.github.rest.repos.getCollaboratorPermissionLevel = async () => ({
    data: { permission: 'read' },
  });
  await admit({ ...unauthorized, outputDir: '/not-used' });
  assert.equal(unauthorized.writes.length, 0);
  assert.equal(unauthorized.outputs.accepted, undefined);
  const duplicate = harness();
  const paginate = duplicate.github.paginate;
  duplicate.github.paginate = async (method) =>
    method === 'checks'
      ? [
          {
            status: 'in_progress',
            external_id: 'verify-ios:90:1:4',
            app: { slug: 'github-actions' },
          },
        ]
      : paginate(method);
  await admit({ ...duplicate, outputDir: '/not-used' });
  assert.equal(duplicate.outputs.accepted, undefined);
  assert.match(duplicate.writes[0].body, /already running/);
});
test('completion recovers cancellation metadata from a bot marker', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'verify-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const h = harness();
  const request = {
    version: 1,
    repository: 'owner/app',
    pr: 12,
    headSha: sha,
    runId: 100,
    attempt: 1,
    commentId: 5,
    checkId: 30,
  };
  h.context.payload = {
    workflow_run: {
      id: 100,
      run_attempt: 1,
      event: 'issue_comment',
      path: '.github/workflows/verify-ios.yml',
      head_repository: { full_name: 'owner/app' },
      conclusion: 'cancelled',
      created_at: '2026-01-01',
      html_url: 'https://github.com/run',
    },
  };
  h.github.rest.checks.get = async () => ({
    data: { external_id: 'verify-ios:100:1:5', head_sha: sha, app: { slug: 'github-actions' } },
  });
  h.github.paginate = async (method) =>
    method === 'all-comments'
      ? [{ id: 40, user: { login: 'github-actions[bot]' }, body: marker(request) }]
      : [];
  await publish({ ...h, directory });
  assert.equal(h.writes[0].conclusion, 'cancelled');
  assert.match(h.writes[1].body, /CANCELLED/);
});
test('report labels stale results and escapes mentions and markup', () => {
  const request = { headSha: sha };
  const report = renderReport(
    request,
    { rationale: '<script>@someone</script>', scenarios: [] },
    'PASS',
    true,
    'https://github.com/run',
    [],
  );
  assert.match(report, /Stale/);
  assert.ok(!report.includes('<script>'));
  assert.ok(!report.includes('@someone'));
});
test('a build failure produces BLOCKED even without test evidence', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'verify-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(`${directory}/request`);
  const h = harness();
  const request = {
    version: 1,
    repository: 'owner/app',
    pr: 12,
    headSha: sha,
    runId: 100,
    attempt: 1,
    commentId: 5,
    checkId: 30,
  };
  await writeFile(`${directory}/request/request.json`, JSON.stringify(request));
  h.context.payload = {
    workflow_run: {
      id: 100,
      run_attempt: 1,
      event: 'issue_comment',
      path: '.github/workflows/verify-ios.yml',
      head_repository: { full_name: 'owner/app' },
      conclusion: 'failure',
      html_url: 'https://github.com/run',
    },
  };
  h.github.rest.checks.get = async () => ({
    data: { external_id: 'verify-ios:100:1:5', head_sha: sha, app: { slug: 'github-actions' } },
  });
  await publish({ ...h, directory });
  assert.equal(h.writes[0].conclusion, 'failure');
  assert.match(h.writes[1].body, /BLOCKED/);
});

test('a partial rerun links current evidence and retains reused build and request artifacts', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'verify-rerun-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(`${directory}/evidence`);
  const h = harness();
  const request = {
    version: 1,
    repository: 'owner/app',
    pr: 12,
    headSha: sha,
    runId: 100,
    attempt: 1,
    commentId: 5,
    checkId: 30,
  };
  const result = {
    version: 1,
    headSha: sha,
    disposition: 'ready',
    agentCompleted: true,
    verdict: 'PASS',
    limitations: [],
    agentAttempts: [
      { provider: 'copilot', model: 'auto', reason: 'quota_exhausted' },
      { provider: 'openrouter', model: 'example/vision:free' },
    ],
    scenarios: [
      {
        id: 'changed-ui',
        name: 'Changed UI',
        coverage: 'PR change',
        fixture: 'success',
        status: 'PASS',
        exitCode: 0,
        junitVerified: true,
      },
    ],
  };
  await writeFile(`${directory}/evidence/result.json`, JSON.stringify(result));
  h.context.payload = {
    workflow_run: {
      id: 100,
      run_attempt: 3,
      event: 'issue_comment',
      path: '.github/workflows/verify-ios.yml',
      head_repository: { full_name: 'owner/app' },
      conclusion: 'success',
      created_at: '2026-01-01',
      html_url: 'https://github.com/owner/app/actions/runs/100',
    },
  };
  h.github.rest.checks.get = async () => ({
    data: { external_id: 'verify-ios:100:1:5', head_sha: sha, app: { slug: 'github-actions' } },
  });
  const artifacts = [
    'verify-request-1',
    'ios-build-1',
    'ios-build-2',
    'ios-app-2',
    'ios-evidence-1',
    'ios-evidence-2',
    'ios-evidence-3',
    'ios-evidence-4',
  ].map((name, id) => ({ name, id }));
  h.github.paginate = async (method) =>
    method === 'all-comments'
      ? [{ id: 40, user: { login: 'github-actions[bot]' }, body: marker(request) }]
      : method === 'artifacts'
        ? artifacts
        : [];
  await publish({ ...h, directory });
  assert.equal(h.writes[0].conclusion, 'success');
  const body = h.writes[1].body;
  assert.ok(
    body.includes(
      '1. GitHub Copilot `auto` (quota exhausted)\n2. OpenRouter `example/vision:free`',
    ),
  );
  for (const name of ['ios-evidence-3', 'ios-build-2', 'ios-app-2', 'verify-request-1'])
    assert.ok(body.includes(name), `Missing ${name}`);
  for (const name of ['ios-evidence-1', 'ios-evidence-2', 'ios-evidence-4', 'ios-build-1'])
    assert.ok(!body.includes(name), `Stale/future ${name}`);
  assert.match(h.writes[0].details_url, /\/attempts\/3$/);
  assert.match(body, /\/attempts\/3\)/);
});

test('missing rerun evidence never falls back to a previous attempt', () => {
  const artifacts = [
    'ios-evidence-1',
    'ios-build-1',
    'ios-app-1',
    'verify-request-1',
    'ios-build-3',
    'other-2',
  ].map((name) => ({ name }));
  assert.deepEqual(
    selectArtifacts(artifacts, 1, 2).map((a) => a.name),
    ['ios-build-1', 'ios-app-1', 'verify-request-1'],
  );
  assert.deepEqual(selectArtifacts(artifacts, 2, 2), []);
});

test('completion posts a new verdict, links progress, and is idempotent per attempt', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'verify-final-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(`${directory}/request`);
  await mkdir(`${directory}/evidence`);
  const h = harness();
  const request = {
    version: 1,
    repository: 'owner/app',
    pr: 12,
    headSha: sha,
    runId: 100,
    attempt: 1,
    commentId: 5,
    checkId: 30,
  };
  await writeFile(`${directory}/request/request.json`, JSON.stringify(request));
  await writeFile(
    `${directory}/evidence/result.json`,
    JSON.stringify({
      version: 1,
      headSha: sha,
      disposition: 'ready',
      agentCompleted: true,
      verdict: 'PASS',
      limitations: [],
      scenarios: [
        {
          id: 'changed-ui',
          name: 'Changed UI',
          coverage: 'The new control responds',
          fixture: 'success',
          status: 'PASS',
          exitCode: 0,
          junitVerified: true,
        },
      ],
    }),
  );
  h.comments.push({
    id: 40,
    user: { login: 'github-actions[bot]' },
    body: `${marker(request)}\nRunning`,
  });
  h.context.payload = {
    workflow_run: {
      id: 100,
      run_attempt: 1,
      event: 'issue_comment',
      path: '.github/workflows/verify-ios.yml',
      head_repository: { full_name: 'owner/app' },
      conclusion: 'success',
    },
  };
  h.github.rest.checks.get = async () => ({
    data: { external_id: 'verify-ios:100:1:5', head_sha: sha, app: { slug: 'github-actions' } },
  });

  await publish({ ...h, directory });
  assert.equal(h.writes[1].issue_number, 12); // New activity, not an edit of progress.
  assert.equal(h.writes[1].comment_id, undefined);
  assert.match(h.writes[1].body, /Final verdict/);
  assert.match(h.writes[1].body, /Working in the tested scenarios/);
  const final = h.comments[1];
  assert.match(h.comments[0].body, new RegExp(`#issuecomment-${final.id}`));
  assert.ok(!h.comments[0].body.includes('Running'));

  h.writes.length = 0;
  await publish({ ...h, directory });
  assert.equal(h.comments.length, 2);
  assert.equal(h.writes[1].comment_id, final.id);
  assert.equal(h.writes[1].issue_number, undefined);

  const oldVerdict = final.body;
  h.context.payload.workflow_run.run_attempt = 2;
  h.pr.head.sha = base;
  h.writes.length = 0;
  await publish({ ...h, directory });
  assert.equal(h.comments.length, 3);
  assert.equal(final.body, oldVerdict); // A rerun retains the earlier attempt's evidence.
  assert.match(h.comments[2].body, /verify-ios-final:100:2/);
  assert.match(h.comments[2].body, /Stale/);
  assert.match(h.comments[0].body, new RegExp(`#issuecomment-${h.comments[2].id}`));
});

test('final comments explain every verdict and include failure evidence and blockers', () => {
  const request = { headSha: sha, runId: 100, attempt: 1 };
  for (const [status, explanation] of Object.entries({
    PASS: 'Working in the tested scenarios',
    FAIL: 'Failing.',
    BLOCKED: 'Untestable.',
    CANCELLED: 'Untestable.',
    SKIPPED: 'Not applicable.',
  })) {
    const report = renderReport(request, undefined, status, false, 'https://github.com/run', []);
    assert.ok(report.includes(`**${status}**`));
    assert.ok(report.includes(explanation));
    assert.match(report, /No scenario replay results are available/);
    assert.match(report, /No downloadable test evidence/);
  }
  const report = renderReport(
    request,
    {
      rationale: 'Zoom button did not respond.',
      limitations: ['Physical autofocus is untestable in the simulator.'],
      scenarios: [
        {
          id: 'zoom',
          name: 'Zoom',
          status: 'FAIL',
          coverage: 'Zoom in button',
          error: 'Expected @user <button> to be enabled',
        },
      ],
    },
    'FAIL',
    false,
    'https://github.com/run',
    [{ name: 'ios-evidence-1', url: 'https://github.com/evidence' }],
  );
  assert.match(report, /Zoom button did not respond/);
  assert.match(report, /Physical autofocus is untestable/);
  assert.match(report, /replay\/zoom\//);
  assert.match(report, /generated\/zoom.yaml/);
  assert.match(report, /session.mp4/);
  assert.match(report, /\[ios-evidence-1\]\(https:\/\/github.com\/evidence\)/);
  assert.ok(!report.includes('@user'));
  assert.ok(!report.includes('<button>'));
  const devicePass = renderReport(
    request,
    {
      rationale: 'Zoom controls enable and reset.',
      limitations: [],
      deviceOnly: ['Actual preview magnification needs a physical camera.'],
      manualChecks: ['Pinch-to-zoom: Maestro does not support two-finger gestures.'],
      scenarios: [{ id: 'zoom', name: 'Zoom', status: 'PASS', coverage: 'Zoom controls' }],
    },
    'PASS',
    false,
    'https://github.com/run',
    [],
  );
  assert.match(devicePass, /\*\*PASS\*\*/);
  assert.match(devicePass, /Requires a physical device \(not verified in CI\)/);
  assert.match(devicePass, /Actual preview magnification needs a physical camera/);
  assert.match(devicePass, /Manual checks required \(not verified in CI\)/);
  assert.match(devicePass, /Pinch-to-zoom/);
  assert.match(devicePass, /remain unverified/);
  assert.doesNotMatch(devicePass, /Limitations \/ blockers/);
  const expired = renderReport(request, undefined, 'BLOCKED', false, 'https://github.com/run', [
    { name: 'ios-evidence-1', url: 'https://github.com/evidence', expired: true },
  ]);
  assert.match(expired, /No downloadable test evidence/);
  assert.match(expired, /\(expired\)/);
});
