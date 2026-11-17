import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';

const main = parse(await readFile(new URL('../../../.github/workflows/verify-ios.yml', import.meta.url), 'utf8'));
const report = parse(await readFile(new URL('../../../.github/workflows/verify-ios-report.yml', import.meta.url), 'utf8'));

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
  assert.equal(report.jobs.report.concurrency.group, 'verify-report-${{ github.event.workflow_run.id }}');
  assert.equal(report.jobs.report.concurrency['cancel-in-progress'], false);
});

test('trusted tooling and PR source are explicitly checked out at distinct captured SHAs', () => {
  for (const job of [main.jobs.build, main.jobs.verify]) {
    const checkouts = job.steps.filter(s => s.uses?.startsWith('actions/checkout@'));
    assert.equal(checkouts.find(s => s.with.path === 'ci').with.ref, '${{ github.sha }}');
    assert.equal(checkouts.find(s => s.with.path === 'pr-source').with.ref, '${{ needs.request.outputs.head_sha }}');
    assert.ok(checkouts.every(s => s.with['persist-credentials'] === false));
  }
  const reportCheckouts = report.jobs.report.steps.filter(s => s.uses?.startsWith('actions/checkout@'));
  assert.equal(reportCheckouts.length, 1);
  assert.equal(reportCheckouts[0].with.ref, undefined); // workflow_run's trusted default branch
});

test('binary reuse is exact-only and validated before bypassing compilation', () => {
  const steps = main.jobs.build.steps;
  const restore = steps.find(s => s.id === 'app-cache');
  assert.equal(restore.with.key, '${{ steps.build-key.outputs.key }}');
  assert.equal(restore.with['restore-keys'], undefined);
  const validate = steps.find(s => s.id === 'cached-app');
  assert.match(validate.run, /--validate-only/);
  assert.equal(validate['continue-on-error'], true);
  const build = steps.find(s => s.name === 'Build Release simulator binary');
  assert.equal(build.if, "steps.cached-app.outcome != 'success'");
  assert.equal(build.env.VERIFY_BUILD_KEY, '${{ steps.build-key.outputs.key }}');
  assert.equal(steps.find(s => s.name === 'Cache validated simulator binary').if, "success() && steps.app-cache.outputs.cache-hit != 'true'");
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

test('verification uses modern CoreSimulator while the Release binary keeps its pinned build environment', () => {
  assert.equal(main.jobs.build['runs-on'], 'macos-26');
  assert.equal(main.jobs.build.env.DEVELOPER_DIR, '/Applications/Xcode_26.6.app/Contents/Developer');
  assert.equal(main.jobs.verify['runs-on'], 'xcode-27');
  assert.equal(main.jobs.verify.env.DEVELOPER_DIR, '/Applications/Xcode_27.1.app/Contents/Developer');
  assert.equal(main.jobs.verify['timeout-minutes'], 60);
});
