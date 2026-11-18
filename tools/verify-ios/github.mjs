import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { verdict, checkConclusion, resultSchema } from './policy.mjs';

export const CHECK_NAME = 'iOS PR Verification';
export const isCommand = (event) =>
  event.action === 'created' &&
  !!event.issue?.pull_request &&
  event.comment?.user?.type === 'User' &&
  event.comment.body.trim() === '/verify';
export const canVerify = (permission) => ['write', 'maintain', 'admin'].includes(permission);
export const isEligible = (pr, repo) => pr.state === 'open' && pr.head?.repo?.full_name === repo;
export const marker = (request) => `<!-- verify-ios:${JSON.stringify(request)} -->`;
export const parseMarker = (body) => {
  try {
    return JSON.parse(body.match(/<!-- verify-ios:(\{[^\n]*\}) -->/)?.[1]);
  } catch {
    return null;
  }
};
const escape = (text) =>
  String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('@', '@\u200b')
    .replaceAll('`', '\\`')
    .replaceAll('[', '\\[')
    .replaceAll(']', '\\]');
const externalId = (r) => `verify-ios:${r.runId}:${r.attempt}:${r.commentId}`;
const finalMarker = (request, attempt) => `<!-- verify-ios-final:${request.runId}:${attempt} -->`;
const verdictSummary = {
  PASS: 'Working in the tested scenarios. All listed scenarios replayed successfully. Physical-device-only behavior, if listed, is not covered.',
  FAIL: 'Failing. At least one replayed scenario failed; inspect its assertions and logs below.',
  BLOCKED: 'Untestable. Verification could not establish whether the PR change works.',
  SKIPPED:
    'Not applicable. No simulator-verifiable iOS UI change was identified; this is not a test pass.',
  CANCELLED: 'Untestable. Verification was cancelled before a final assessment could be made.',
};

export function selectArtifacts(artifacts, requestAttempt, runAttempt) {
  const selected = [];
  for (const prefix of ['ios-evidence', 'ios-build', 'ios-app', 'verify-request']) {
    const candidates = artifacts
      .filter((a) => {
        const match = a.name.match(new RegExp(`^${prefix}-(\\d+)$`));
        if (!match) return false;
        const attempt = Number(match[1]);
        if (prefix === 'ios-evidence') return attempt === runAttempt;
        if (prefix === 'verify-request') return attempt === requestAttempt;
        return attempt >= requestAttempt && attempt <= runAttempt;
      })
      .sort((a, b) => Number(b.name.split('-').at(-1)) - Number(a.name.split('-').at(-1)));
    if (candidates.length) selected.push(candidates[0]);
  }
  return selected;
}

export async function admit({ github, context, core, outputDir }) {
  const event = context.payload;
  if (!isCommand(event)) return;
  const repo = context.repo;
  const fullName = `${repo.owner}/${repo.repo}`;
  const { data: permission } = await github.rest.repos.getCollaboratorPermissionLevel({
    ...repo,
    username: event.comment.user.login,
  });
  if (!canVerify(permission.permission)) {
    core.notice('Ignoring /verify from a user without write access');
    return;
  }
  const { data: pr } = await github.rest.pulls.get({ ...repo, pull_number: event.issue.number });
  if (!isEligible(pr, fullName)) {
    await github.rest.issues.createComment({
      ...repo,
      issue_number: pr.number,
      body: '`/verify` supports open PRs from branches in this repository.',
    });
    return;
  }
  const checks = await github.paginate(github.rest.checks.listForRef, {
    ...repo,
    ref: pr.head.sha,
    check_name: CHECK_NAME,
    per_page: 100,
  });
  for (const check of checks) {
    const match = check.external_id?.match(/^verify-ios:(\d+):\d+:\d+$/);
    if (!match || check.status === 'completed' || check.app?.slug !== 'github-actions') continue;
    const { data: run } = await github.rest.actions.getWorkflowRun({
      ...repo,
      run_id: Number(match[1]),
    });
    if (run.status !== 'completed') {
      await github.rest.issues.createComment({
        ...repo,
        issue_number: pr.number,
        body: `Verification of \`${pr.head.sha}\` is already running: [view run](${run.html_url}).`,
      });
      return;
    }
  }
  const request = {
    version: 1,
    repository: fullName,
    pr: pr.number,
    headSha: pr.head.sha,
    baseSha: pr.base.sha,
    trustedSha: context.sha,
    runId: context.runId,
    attempt: Number(process.env.GITHUB_RUN_ATTEMPT),
    commentId: event.comment.id,
  };
  const runUrl = `${context.serverUrl}/${fullName}/actions/runs/${request.runId}/attempts/${request.attempt}`;
  const { data: check } = await github.rest.checks.create({
    ...repo,
    name: CHECK_NAME,
    head_sha: request.headSha,
    external_id: externalId(request),
    status: 'in_progress',
    details_url: runUrl,
    output: {
      title: 'Verification requested',
      summary: `PR #${request.pr} at ${request.headSha}. [Workflow](${runUrl})`,
    },
  });
  request.checkId = check.id;
  await mkdir(outputDir, { recursive: true });
  await writeFile(`${outputDir}/request.json`, JSON.stringify(request, null, 2));
  await writeFile(
    `${outputDir}/pr.json`,
    JSON.stringify({ title: pr.title, body: pr.body || '' }, null, 2),
  );
  // The bot marker is a recovery record if cancellation interrupts artifact upload.
  await github.rest.issues.createComment({
    ...repo,
    issue_number: request.pr,
    body: `${marker(request)}\n## iOS PR Verification\n\nRunning PR-specific verification of \`${request.headSha}\`. [View run](${runUrl})`,
  });
  core.setOutput('accepted', 'true');
  core.setOutput('head_sha', request.headSha);
  core.setOutput('base_sha', request.baseSha);
  core.setOutput('request_artifact', `verify-request-${request.attempt}`);
}

export function renderReport(
  request,
  result,
  status,
  stale,
  runUrl,
  artifacts,
  attempt = request.attempt,
) {
  const lines = [
    marker(request),
    finalMarker(request, attempt),
    '## iOS PR Verification — Final verdict',
    '',
    `**${status}** · Commit: \`${request.headSha}\` · Attempt: ${attempt}`,
    '',
    verdictSummary[status],
    '',
  ];
  if (stale)
    lines.push(
      '**Stale:** the PR head has changed. Post `/verify` again to test the new commit.',
      '',
    );
  lines.push('Coverage: PR changes only, using a synthetic local backend.', '');
  if (result?.rationale) lines.push(escape(result.rationale).slice(0, 8000), '');
  lines.push('### Tested scenarios', '');
  if (!result?.scenarios?.length) lines.push('No scenario replay results are available.');
  for (const scenario of result?.scenarios || []) {
    lines.push(
      `- **${escape(scenario.status)}** — ${escape(scenario.name)}: ${escape(scenario.coverage)}`,
    );
    if (scenario.error) lines.push(`  Replay error: ${escape(scenario.error).slice(0, 2000)}`);
    lines.push(
      `  Evidence paths, when captured: \`replay/${scenario.id}/\` (JUnit, logs, screenshots), \`generated/${scenario.id}.yaml\` (assertions).`,
    );
  }
  const limitations = [result?.setupError, ...(result?.limitations || [])].filter(Boolean);
  if (limitations.length)
    lines.push(
      '',
      '**Limitations / blockers**',
      '',
      ...limitations.map((s) => `- ${escape(s).slice(0, 2000)}`),
    );
  if (result?.manualChecks?.length)
    lines.push(
      '',
      '**Manual checks required (not verified in CI)**',
      '',
      'PASS covers only the replayed assertions. These harness exclusions remain unverified and do not affect the CI verdict.',
      '',
      ...result.manualChecks.map((s) => `- ${escape(s).slice(0, 2000)}`),
    );
  if (result?.deviceOnly?.length)
    lines.push(
      '',
      '**Requires a physical device (not verified in CI)**',
      '',
      'CI runs on a simulator only. These changes do not affect the verdict; check them on a real iPhone.',
      '',
      ...result.deviceOnly.map((s) => `- ${escape(s).slice(0, 2000)}`),
    );
  if (!result)
    lines.push('Verification did not produce a result. See the build and workflow logs.');
  lines.push('', '### Evidence', '', `[Workflow and logs](${runUrl})`, '');
  if (!artifacts.some((a) => a.name.startsWith('ios-evidence-') && !a.expired)) {
    lines.push(
      'No downloadable test evidence is available for this attempt. Check the workflow and build logs.',
      '',
    );
  }
  for (const artifact of artifacts) {
    const description = artifact.name.startsWith('ios-evidence-')
      ? ' — recording (`session.mp4`), screenshots, test plan, replay assertions, JUnit results, and logs, when captured'
      : artifact.name.startsWith('ios-build-')
        ? ' — build logs'
        : artifact.name.startsWith('ios-app-')
          ? ' — simulator app archive'
          : ' — captured verification request';
    lines.push(
      `- [${escape(artifact.name)}](${artifact.url})${artifact.expired ? ' (expired)' : ''}${description}`,
    );
  }
  lines.push(
    '',
    'Evidence and logs expire after seven days; the app archive expires after one day. PASS covers only the listed assertions; real OCR, Settle Up, and camera hardware are not verified.',
  );
  return Buffer.from(lines.join('\n')).subarray(0, 60000).toString('utf8');
}

export async function publish({ github, context, core, directory }) {
  const run = context.payload.workflow_run;
  const repo = context.repo;
  const fullName = `${repo.owner}/${repo.repo}`;
  if (
    run.event !== 'issue_comment' ||
    run.path !== '.github/workflows/verify-ios.yml' ||
    run.head_repository?.full_name !== fullName
  )
    throw new Error('Unexpected source workflow');
  let request;
  try {
    request = JSON.parse(await readFile(`${directory}/request/request.json`, 'utf8'));
  } catch {
    /* cancellation fallback below */
  }
  let comments;
  if (!request) {
    // No PR-code checkout or execution in this privileged job. Only our own bot's
    // validated marker may recover a request; ordinary comments are never trusted.
    comments = await github.paginate(github.rest.issues.listCommentsForRepo, {
      ...repo,
      sort: 'created',
      direction: 'desc',
      since: run.created_at,
      per_page: 100,
    });
    request = comments
      .filter((c) => c.user?.login === 'github-actions[bot]')
      .map((c) => parseMarker(c.body))
      .filter((r) => r?.runId === run.id && r.attempt <= run.run_attempt)
      .sort((a, b) => b.attempt - a.attempt)[0];
    if (!request) {
      core.notice('No authorized /verify request to report');
      return;
    }
  }
  if (
    request.version !== 1 ||
    request.repository !== fullName ||
    request.runId !== run.id ||
    !Number.isSafeInteger(request.attempt) ||
    request.attempt > run.run_attempt ||
    !/^[a-f0-9]{40}$/.test(request.headSha) ||
    !Number.isSafeInteger(request.pr) ||
    !Number.isSafeInteger(request.checkId)
  )
    throw new Error('Invalid request metadata');
  const { data: check } = await github.rest.checks.get({ ...repo, check_run_id: request.checkId });
  if (
    check.external_id !== externalId(request) ||
    check.head_sha !== request.headSha ||
    check.app?.slug !== 'github-actions'
  )
    throw new Error('Check provenance mismatch');
  let result;
  try {
    result = resultSchema.parse(
      JSON.parse(await readFile(`${directory}/evidence/result.json`, 'utf8')),
    );
    if (result.headSha !== request.headSha || result.version !== 1)
      throw new Error('Result SHA mismatch');
  } catch (error) {
    core.warning(`No valid result: ${error.message}`);
    result = undefined;
  }
  const status = verdict(result, run.conclusion);
  const { data: pr } = await github.rest.pulls.get({ ...repo, pull_number: request.pr });
  const stale = pr.head.sha !== request.headSha;
  const availableArtifacts = await github.paginate(github.rest.actions.listWorkflowRunArtifacts, {
    ...repo,
    run_id: run.id,
    per_page: 100,
  });
  // A partial rerun reuses admission/build outputs, but its verdict must link to
  // its own evidence. Never substitute an earlier attempt's test artifacts.
  const artifacts = selectArtifacts(availableArtifacts, request.attempt, run.run_attempt).map(
    (a) => ({
      ...a,
      url: `${context.serverUrl}/${fullName}/actions/runs/${run.id}/artifacts/${a.id}`,
    }),
  );
  const runUrl = `${context.serverUrl}/${fullName}/actions/runs/${run.id}/attempts/${run.run_attempt}`;
  const body = renderReport(request, result, status, stale, runUrl, artifacts, run.run_attempt);
  await github.rest.checks.update({
    ...repo,
    check_run_id: request.checkId,
    status: 'completed',
    conclusion: checkConclusion[status],
    details_url: runUrl,
    output: { title: `${status}${stale ? ' (stale commit)' : ''}`, summary: body },
  });
  comments ??= await github.paginate(github.rest.issues.listComments, {
    ...repo,
    issue_number: request.pr,
    per_page: 100,
  });
  const ownComments = comments.filter(
    (c) => c.user?.login === 'github-actions[bot]' && c.body?.includes(marker(request)),
  );
  const existing = ownComments.find((c) => c.body.includes(finalMarker(request, run.run_attempt)));
  // Post completion separately so it appears as new PR activity. Re-publishing
  // the same attempt updates its verdict; a new verification attempt gets its own.
  const { data: finalComment } = existing
    ? await github.rest.issues.updateComment({ ...repo, comment_id: existing.id, body })
    : await github.rest.issues.createComment({ ...repo, issue_number: request.pr, body });
  const progress = ownComments.find((c) => !c.body.includes('<!-- verify-ios-final:'));
  if (progress) {
    const finalUrl =
      finalComment.html_url ||
      `${context.serverUrl}/${fullName}/pull/${request.pr}#issuecomment-${finalComment.id}`;
    await github.rest.issues.updateComment({
      ...repo,
      comment_id: progress.id,
      body: `${marker(request)}\n## iOS PR Verification\n\nCompleted: **${status}** for \`${request.headSha}\` (attempt ${run.run_attempt}).${stale ? ' **Stale:** the PR head has changed.' : ''}\n\n[Final verdict and evidence](${finalUrl})`,
    });
  }
  await core.summary.addRaw(body).write();
}
