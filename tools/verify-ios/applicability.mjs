export const CHECK_NAME = 'iOS PR Verification';

const appDirectory = /^(app|assets|components|hooks|ios|lib|modules|src|utils)\//;
const buildConfig = /^(app|babel|metro)\.config\.[^/]+$/;
const buildFiles = new Set([
  '.npmrc',
  '.nvmrc',
  'app.json',
  'eas.json',
  'package.json',
  'package-lock.json',
  'tsconfig.json',
]);

function affectsApp(filename) {
  return (
    !/\.(md|mdx)$/i.test(filename) &&
    (appDirectory.test(filename) || buildConfig.test(filename) || buildFiles.has(filename))
  );
}

export async function needsVerification(github, repo, pr) {
  // GitHub's PR-files endpoint returns at most 3,000 files.
  if (pr.changed_files > 3000) return true;
  const params = { ...repo, pull_number: pr.number };
  const files = await github.paginate(github.rest.pulls.listFiles, { ...params, per_page: 100 });
  // The files endpoint follows the live PR. Confirm it still has the same revisions.
  const { data: current } = await github.rest.pulls.get(params);
  if (
    current.state !== 'open' ||
    current.head.sha !== pr.head.sha ||
    current.base.sha !== pr.base.sha ||
    current.base.ref !== pr.base.ref
  ) {
    return null;
  }
  return (
    files.length !== pr.changed_files ||
    files.some(
      ({ filename, previous_filename }) =>
        affectsApp(filename) || (previous_filename && affectsApp(previous_filename)),
    )
  );
}

export async function isExempt({ github, context, core }) {
  const eventPR = context.payload.pull_request;
  const repo = context.repo;
  const { data: pr } = await github.rest.pulls.get({ ...repo, pull_number: eventPR.number });
  if (pr.state !== 'open' || pr.head.sha !== eventPR.head.sha || pr.base.ref !== eventPR.base.ref) {
    return false;
  }
  const required = await needsVerification(github, repo, pr);
  if (required) core.notice('iOS verification is required. An authorized writer can post /verify.');
  return required === false;
}
