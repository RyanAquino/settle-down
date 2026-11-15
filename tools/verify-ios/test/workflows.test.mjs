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
