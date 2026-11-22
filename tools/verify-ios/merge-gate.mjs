import { setTimeout as delay } from 'node:timers/promises';
import { needsVerification } from './applicability.mjs';
import { externalId, finalMarker, marker, parseMarker } from './request-marker.mjs';

const workflow = 'verify-ios-applicability.yml';

export async function refreshGate(github, repo, pr) {
  // Re-evaluate the native PR job. Its runner always reads the latest verdict,
  // so even a late report from an older attempt cannot overwrite a newer one.
  const runs = await github.paginate(github.rest.actions.listWorkflowRuns, {
    ...repo,
    workflow_id: workflow,
    event: 'pull_request_target',
    head_sha: pr.head.sha,
    per_page: 100,
  });
  const run = runs
    .filter((r) => r.pull_requests.some((p) => p.number === pr.number))
    .sort((a, b) => b.id - a.id)[0];
  if (!run) return;
  for (let retry = 0; retry < 20; retry++) {
    const { data } = await github.rest.actions.getWorkflowRun({ ...repo, run_id: run.id });
    if (data.status === 'completed') {
      try {
        await github.rest.actions.reRunWorkflow({ ...repo, run_id: run.id });
        return;
      } catch (error) {
        if (error.status !== 409) throw error;
      }
    }
    await delay(3000);
  }
  throw new Error(
    'The PR gate is busy. Re-run iOS verification applicability to read the published result.',
  );
}

async function sameComparison(github, repo, request, pr) {
  if (request.baseSha === pr.base.sha) return true;
  // Main can advance while the PR is open. The verifier assessed the diff
  // from the merge base to the captured head as well as building the head tree.
  const mergeBase = async (base, head) => {
    const { data } = await github.rest.repos.compareCommitsWithBasehead({
      ...repo,
      basehead: `${base}...${head}`,
      per_page: 1,
    });
    return data.merge_base_commit.sha;
  };
  const [tested, current] = await Promise.all([
    mergeBase(request.baseSha, request.headSha),
    mergeBase(pr.base.sha, pr.head.sha),
  ]);
  return tested === current;
}

export async function evaluateGate({ github, context, core }) {
  const { repo } = context;
  const event = context.payload.pull_request;
  const { data: pr } = await github.rest.pulls.get({ ...repo, pull_number: event.number });
  if (pr.state !== 'open' || pr.head.sha !== event.head.sha || pr.base.ref !== event.base.ref)
    throw new Error('This PR revision is no longer current.');
  const required = await needsVerification(github, repo, pr);
  if (required === null) throw new Error('The PR changed during classification.');
  if (!required) {
    await core.summary.addRaw('The changed files are exempt from simulator verification.').write();
    return;
  }
  const comments = await github.paginate(github.rest.issues.listComments, {
    ...repo,
    issue_number: pr.number,
    per_page: 100,
  });
  const requests = comments
    .filter(
      (c) => c.user?.login === 'github-actions[bot]' && c.body?.startsWith('<!-- verify-ios:'),
    )
    .map((c) => parseMarker(c.body))
    .filter(
      (r) =>
        r?.version === 1 && r.pr === pr.number && r.repository === `${repo.owner}/${repo.repo}`,
    )
    .sort((a, b) => b.checkId - a.checkId);
  let request = requests.find((r) => r.headSha === pr.head.sha);
  if (!request && requests.length) {
    const { data: head } = await github.rest.git.getCommit({ ...repo, commit_sha: pr.head.sha });
    if (head.parents.length === 1) {
      const parentSha = head.parents[0].sha;
      const parentRequest = requests.find((r) => r.headSha === parentSha);
      if (parentRequest) {
        const { data: parent } = await github.rest.git.getCommit({
          ...repo,
          commit_sha: parentSha,
        });
        if (parent.tree.sha === head.tree.sha) request = parentRequest;
      }
    }
  }
  if (!request) throw new Error('No iOS verdict for this revision. Post /verify on the PR.');
  const [{ data: check }, { data: run }] = await Promise.all([
    github.rest.checks.get({ ...repo, check_run_id: request.checkId }),
    github.rest.actions.getWorkflowRun({ ...repo, run_id: request.runId }),
  ]);
  if (
    check.head_sha !== request.headSha ||
    check.app?.slug !== 'github-actions' ||
    check.external_id !== externalId(request) ||
    run.path !== '.github/workflows/verify-ios.yml' ||
    run.event !== 'issue_comment' ||
    run.head_repository?.full_name !== request.repository ||
    run.head_sha !== request.trustedSha ||
    !(await sameComparison(github, repo, request, pr))
  ) {
    throw new Error('Verification record does not match this PR and its source workflow.');
  }
  const title = check.output?.title;
  const expected =
    check.conclusion === 'success' ? 'PASS' : check.conclusion === 'neutral' ? 'SKIPPED' : null;
  if (
    run.status !== 'completed' ||
    run.conclusion !== 'success' ||
    check.status !== 'completed' ||
    !expected ||
    (title !== expected && title !== `${expected} (stale commit)`) ||
    !check.output?.summary?.startsWith(
      `${marker(request)}\n${finalMarker(request, run.run_attempt)}\n`,
    )
  ) {
    throw new Error(`Latest verification has no passing final verdict. See ${run.html_url}`);
  }
  await core.summary
    .addRaw(
      `${expected} for verified commit \`${request.headSha}\`. [Verification run](${run.html_url}/attempts/${run.run_attempt}).`,
    )
    .write();
}
