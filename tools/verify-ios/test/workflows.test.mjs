import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { matchesGlob } from 'node:path';
import { parse } from 'yaml';

const main = parse(
  await readFile(new URL('../../../.github/workflows/verify-ios.yml', import.meta.url), 'utf8'),
);
const report = parse(
  await readFile(
    new URL('../../../.github/workflows/verify-ios-report.yml', import.meta.url),
    'utf8',
  ),
);

test('native smoke runs when an Expo icon or splash image changes', async () => {
  const root = new URL('../../../', import.meta.url);
  const native = parse(await readFile(new URL('.github/workflows/native.yml', root), 'utf8'));
  const { expo } = JSON.parse(await readFile(new URL('app.json', root), 'utf8'));
  const splash = expo.plugins.find((entry) => entry[0] === 'expo-splash-screen');
  const paths = native.on.pull_request.paths;
  for (const asset of [expo.icon, splash[1].image]) {
    assert.ok(
      paths.some((pattern) => matchesGlob(asset.replace(/^\.\//, ''), pattern)),
      asset,
    );
  }
});

test('every applicability event classifies PR metadata with a trusted read-only checkout', async () => {
  const scope = parse(
    await readFile(
      new URL('../../../.github/workflows/verify-ios-applicability.yml', import.meta.url),
      'utf8',
    ),
  );
  assert.deepEqual(scope.on, {
    pull_request_target: {
      branches: ['main'],
      types: ['opened', 'synchronize', 'reopened', 'edited'],
    },
  });
  assert.deepEqual(scope.permissions, {});
  const job = scope.jobs.applicability;
  assert.deepEqual(job.permissions, { contents: 'read', 'pull-requests': 'read' });
  assert.equal(job.if, undefined);
  assert.equal(job['runs-on'], 'ubuntu-latest');
  assert.deepEqual(
    job.steps.filter((step) => step.uses?.startsWith('actions/checkout@')).map((step) => step.with),
    [{ ref: '${{ github.sha }}', 'persist-credentials': false }],
  );
  const classify = job.steps.find((step) => step.id === 'classify');
  assert.equal(classify.if, undefined);
  assert.match(classify.with.script, /return (?:await )?isExempt\(/);
  assert.equal(job.outputs.exempt, '${{ steps.classify.outputs.result }}');

  // A static required job name would let a skipped job satisfy the ruleset for app changes.
  const exemption = scope.jobs.exemption;
  assert.equal(exemption.needs, 'applicability');
  const confirmed = "needs.applicability.outputs.exempt == 'true'";
  assert.equal(exemption.if, confirmed);
  assert.equal(
    exemption.name,
    `\${{ needs.applicability.result == 'success' && ${confirmed} && 'iOS PR Verification' || 'iOS verification exemption' }}`,
  );
});

test('comment admission and completion reporting use separate privilege boundaries', () => {
  assert.deepEqual(main.on, { issue_comment: { types: ['created'] } });
  assert.deepEqual(report.on.workflow_run.types, ['completed']);
  assert.deepEqual(main.permissions, {});
  assert.equal(main.jobs.request.concurrency['cancel-in-progress'], false);
  assert.equal(main.jobs.build.permissions['copilot-requests'], undefined);
  assert.equal(main.jobs.build.permissions['pull-requests'], undefined);
  assert.equal(main.jobs.verify.permissions['copilot-requests'], 'write');
  assert.equal(main.jobs.verify.permissions['pull-requests'], undefined);
  assert.equal(main.jobs.verify.permissions.checks, undefined);
  assert.equal(report.jobs.report.permissions['pull-requests'], 'write');
  assert.equal(report.jobs.report.permissions.checks, 'write');
  assert.equal(
    report.jobs.report.concurrency.group,
    'verify-report-${{ github.event.workflow_run.id }}',
  );
  assert.equal(report.jobs.report.concurrency['cancel-in-progress'], false);
});

test('trusted tooling and PR source are explicitly checked out at distinct captured SHAs', () => {
  for (const job of [main.jobs.build, main.jobs.verify]) {
    const checkouts = job.steps.filter((s) => s.uses?.startsWith('actions/checkout@'));
    assert.equal(checkouts.find((s) => s.with.path === 'ci').with.ref, '${{ github.sha }}');
    assert.equal(
      checkouts.find((s) => s.with.path === 'pr-source').with.ref,
      '${{ needs.request.outputs.head_sha }}',
    );
    assert.ok(checkouts.every((s) => s.with['persist-credentials'] === false));
  }
  const reportCheckouts = report.jobs.report.steps.filter((s) =>
    s.uses?.startsWith('actions/checkout@'),
  );
  assert.equal(reportCheckouts.length, 1);
  assert.equal(reportCheckouts[0].with.ref, undefined); // workflow_run's trusted default branch
});

test('binary reuse is exact-only and validated before bypassing compilation', () => {
  const steps = main.jobs.build.steps;
  const restore = steps.find((s) => s.id === 'app-cache');
  assert.equal(restore.with.key, '${{ steps.build-key.outputs.key }}');
  assert.equal(restore.with['restore-keys'], undefined);
  const validate = steps.find((s) => s.id === 'cached-app');
  assert.match(validate.run, /--validate-only/);
  assert.equal(validate['continue-on-error'], true);
  const build = steps.find((s) => s.name === 'Build Release simulator binary');
  assert.equal(build.if, "steps.cached-app.outcome != 'success'");
  assert.equal(build.env.VERIFY_BUILD_KEY, '${{ steps.build-key.outputs.key }}');
  assert.equal(
    steps.find((s) => s.name === 'Cache validated simulator binary').if,
    "success() && steps.app-cache.outputs.cache-hit != 'true'",
  );
});

test('only the authorized repository-head build opts into cache writes', () => {
  assert.equal(main.jobs.build['cache-mode'], 'write');
  assert.equal(main.jobs.build.if, "needs.request.outputs.accepted == 'true'");
  assert.deepEqual(main.jobs.build.permissions, { contents: 'read' });
  assert.equal(main['cache-mode'], undefined);
  assert.equal(main.jobs.request['cache-mode'], undefined);
  assert.equal(main.jobs.verify['cache-mode'], undefined);
  assert.equal(report['cache-mode'], undefined);
});

test('build and verification use the hosted image with the pinned iOS runtime', () => {
  assert.equal(main.jobs.build['runs-on'], 'macos-26');
  assert.equal(
    main.jobs.build.env.DEVELOPER_DIR,
    '/Applications/Xcode_26.6.app/Contents/Developer',
  );
  assert.equal(main.jobs.verify['runs-on'], 'macos-26');
  assert.equal(
    main.jobs.verify.env.DEVELOPER_DIR,
    '/Applications/Xcode_26.6.app/Contents/Developer',
  );
  assert.equal(main.jobs.verify['timeout-minutes'], 90);
});

test('only the trusted verification step receives the optional OpenRouter key', () => {
  const step = main.jobs.verify.steps.find((step) =>
    step.run?.startsWith('node ci/tools/verify-ios/runner.mjs '),
  );
  assert.equal(step.env.OPENROUTER_API_KEY, '${{ secrets.OPENROUTER_API_KEY }}');
  assert.equal(step.env.IOS_VERIFY_OPENROUTER_MODEL, '${{ vars.IOS_VERIFY_OPENROUTER_MODEL }}');
  assert.equal(step.env.IOS_VERIFY_PROVIDER, '${{ vars.IOS_VERIFY_PROVIDER }}');
  assert.equal(JSON.stringify(main).split('secrets.OPENROUTER_API_KEY').length - 1, 1);
  assert.ok(!JSON.stringify(report).includes('secrets.OPENROUTER_API_KEY'));
});
