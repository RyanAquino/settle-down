import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { provisionSimulator } from '../simulator-setup.mjs';

async function harness(t, fail = () => {}) {
  const evidence = await mkdtemp(path.join(os.tmpdir(), 'simulator-setup-test-'));
  t.after(() => rm(evidence, { recursive: true, force: true }));
  const calls = [];
  let created = 0;
  const run = async (command, args, options) => {
    calls.push({ command, args, options });
    await fail(command, args, created, options);
    if (args[1] === 'create') return { output: `device-${++created}` };
    return { output: '', code: 0 };
  };
  const input = {
    run,
    evidence,
    runtime: 'synthetic-runtime',
    runId: 7,
    appPath: '/app',
    imagePath: '/receipt.png',
    token: 'must-not-log',
    resetFixture: async (route, options) => {
      calls.push({ command: 'fixture-control', args: [route], options });
    },
  };
  return { input, calls, evidence };
}

test('a fresh device imports into Photos before warming the driver on the app without redundant uninstall', async (t) => {
  const h = await harness(t);
  assert.equal(await provisionSimulator(h.input), 'device-1');
  const stages = h.calls
    .slice(1)
    .map(({ command, args }) =>
      command === 'maestro' ? 'hierarchy' : args[1] === 'launch' ? args[3] : args[1],
    );
  assert.deepEqual(stages, [
    'create',
    'boot',
    'bootstatus',
    'com.apple.mobileslideshow',
    'addmedia',
    'install',
    'com.ryan.aquino.settledown',
    'hierarchy',
    'io',
  ]);
  assert.equal(
    h.calls.find((c) => c.command === 'maestro').options.env.XDG_STATE_HOME,
    `${h.evidence}/setup-1-state`,
  );
  assert.ok(!h.calls.some((c) => ['uninstall', 'terminate'].includes(c.args[1])));
  assert.ok(
    !h.calls.some((c) => c.command === 'open' || c.args[1] === 'spawn'),
    'fresh provisioning stays headless without in-device defaults writes',
  );
  const log = await readFile(`${h.evidence}/setup-commands.jsonl`, 'utf8');
  assert.match(log, /install application/);
  assert.doesNotMatch(log, /must-not-log/);
});

test('only setup timeouts retry once, after discarding the failed isolated device', async (t) => {
  const h = await harness(t, (_command, args, created) => {
    if (args[1] === 'addmedia' && created === 1) throw new Error('xcrun simctl timed out');
  });
  assert.equal(await provisionSimulator(h.input), 'device-2');
  assert.ok(h.calls.some((c) => c.args[1] === 'delete' && c.args[2] === 'device-1'));
  assert.ok(!h.calls.some((c) => c.args.includes('all')));
  const attempts = JSON.parse(await readFile(`${h.evidence}/setup-attempts.json`, 'utf8'));
  assert.equal(attempts[0].stage, 'seed receipt photo');
  assert.equal(attempts[1].status, 'success');
});

test('permanent installation errors are not retried or hidden', async (t) => {
  const h = await harness(t, (_command, args) => {
    if (args[1] === 'install') throw new Error('Invalid app binary exited 1');
  });
  await assert.rejects(provisionSimulator(h.input), /install application: Invalid app binary/);
  assert.ok(!h.calls.some((c) => ['ps', 'vm_stat', 'sysctl', 'df'].includes(c.command)));
  assert.equal(h.calls.filter((c) => c.args[1] === 'create').length, 1);
});

test('two timeouts preserve the exact failed stage and stop retrying', async (t) => {
  const h = await harness(t, (_command, args) => {
    if (args[1] === 'addmedia') throw new Error('simctl timed out');
  });
  await assert.rejects(provisionSimulator(h.input), /seed receipt photo: simctl timed out/);
  assert.equal(h.calls.filter((c) => c.args[1] === 'create').length, 2);
});

test('cancellation cleans up the isolated device without starting another attempt', async (t) => {
  const controller = new AbortController();
  const h = await harness(t, (_command, args) => {
    if (args[1] === 'addmedia') {
      controller.abort(new Error('Verification cancelled'));
      throw new Error('simctl timed out');
    }
  });
  await assert.rejects(
    provisionSimulator({ ...h.input, signal: controller.signal, collectDiagnostics: true }),
    /seed receipt photo/,
  );
  assert.equal(h.calls.filter((c) => c.args[1] === 'create').length, 1);
  assert.ok(h.calls.some((c) => c.args[1] === 'delete' && c.options.timeout === 1500));
  assert.ok(!h.calls.some((c) => c.args.includes('screenshot')));
  assert.ok(!h.calls.some((c) => ['ps', 'vm_stat', 'sysctl', 'df'].includes(c.command)));
});

test('the provisioning deadline bounds the full attempt rather than restarting per command', async (t) => {
  let elapsed = 0;
  const h = await harness(t, (_command, args) => {
    if (args.includes('com.apple.mobileslideshow')) elapsed = 890000;
  });
  await provisionSimulator({ ...h.input, now: () => elapsed });
  const photoImport = h.calls.find((c) => c.args[1] === 'addmedia');
  assert.equal(photoImport.options.timeout, 10000);
});

test('hosted cold migration leaves enough time for full driver startup on the same device', async (t) => {
  let elapsed = 0;
  const h = await harness(t, (command, args, _created, options) => {
    const duration = args[1] === 'bootstatus' ? 240000 : command === 'maestro' ? 180000 : 0;
    if (duration > options.timeout) throw new Error('Synthetic cold startup timed out');
    elapsed += duration;
  });
  assert.equal(await provisionSimulator({ ...h.input, now: () => elapsed }), 'device-1');
  assert.equal(h.calls.filter((c) => c.args[1] === 'create').length, 1);
  const driver = h.calls.find((c) => c.command === 'maestro');
  assert.ok(driver.args.includes('--verbose'));
  assert.equal(driver.options.env.MAESTRO_DRIVER_STARTUP_TIMEOUT, '240000');
});

test('fixture readiness precedes device creation and has a bounded cold-start allowance', async (t) => {
  const h = await harness(t);
  let elapsed = 0;
  const resetFixture = async (_route, options) => {
    assert.equal(h.calls.length, 0);
    if (options.timeout < 6000) throw new Error('Cold fixture startup timed out');
    elapsed += 6000;
  };
  await provisionSimulator({ ...h.input, resetFixture, now: () => elapsed });
  const launch = h.calls.find(
    (c) => c.args[1] === 'launch' && !c.args.includes('com.apple.mobileslideshow'),
  );
  assert.equal(launch.options.timeout, 180000);
  assert.equal(h.calls.find((c) => c.args[1] === 'addmedia').options.timeout, 300000);
});

test('CI setup failures capture bounded process-name and resource diagnostics', async (t) => {
  const h = await harness(t, (_command, args) => {
    if (args[1] === 'install') throw new Error('Invalid app binary');
  });
  await assert.rejects(
    provisionSimulator({ ...h.input, collectDiagnostics: true }),
    /Invalid app binary/,
  );
  const diagnostics = h.calls.filter((c) => ['ps', 'vm_stat', 'sysctl', 'df'].includes(c.command));
  assert.equal(diagnostics.length, 4);
  assert.ok(diagnostics.every((c) => c.options.timeout === 1000 && c.options.killGraceMs === 100));
  assert.deepEqual(diagnostics.find((c) => c.command === 'ps').args, [
    '-axo',
    'pid,ppid,stat,pcpu,pmem,rss,comm',
  ]);
});
