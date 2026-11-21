/* global afterEach, beforeEach, describe, expect, it */
const { spawnSync } = require('node:child_process');
const { mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');

let root;
let evidence;
const serial = 'emulator-5554';
const offline = 'Command failed (host:transport:emulator-5554): device offline';
const iosTimeout =
  'xcuitest.installer.LocalXCTestInstaller$IOSDriverTimeoutException: iOS driver not ready in time';

function mockCommand(name, body) {
  writeFileSync(path.join(root, name), '#!/usr/bin/env bash\nset -eu\n' + body, { mode: 0o755 });
}

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'native-smoke-'));
  evidence = path.join(root, 'evidence');
  writeFileSync(path.join(root, 'calls'), '');
  mockCommand(
    'maestro',
    `echo "maestro $*" >> "$MOCK_ROOT/calls"
    attempt=$(grep -c '^maestro ' "$MOCK_ROOT/calls")
    while [ "$#" -gt 0 ]; do
      case "$1" in
        --output) report=$2; shift ;;
        --test-output-dir) evidence=$2; shift ;;
      esac
      shift
    done
    result=$(cat "$MOCK_ROOT/result-$attempt")
    echo "$result" > "$report"
    if [ "$result" = passed ]; then exit 0; fi
    if [ -f "$MOCK_ROOT/commands" ]; then
      cp "$MOCK_ROOT/commands" "$evidence/commands.json"
    fi
    echo "$result" >&2
    exit 1`,
  );
  mockCommand(
    'xcrun',
    `echo "$*" >> "$MOCK_ROOT/calls"
    case "$2" in
      list) echo '{"runtimes":[{"identifier":"com.apple.CoreSimulator.SimRuntime.iOS-26-6","version":"26.6","isAvailable":true}]}' ;;
      create) echo "device-$(grep -c '^simctl create ' "$MOCK_ROOT/calls")" ;;
    esac`,
  );
  mockCommand(
    'adb',
    `echo "adb $*" >> "$MOCK_ROOT/calls"
    case "$*" in
      get-serialno) echo emulator-5554 ;;
      '-s emulator-5554 shell getprop sys.boot_completed') echo 1 ;;
    esac`,
  );
  // The Android job uses GNU timeout on Linux. Keep these fake commands portable to macOS.
  mockCommand('timeout', 'shift 2; exec "$@"');
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

function run(platform, results, commands) {
  results.forEach((result, i) => writeFileSync(path.join(root, `result-${i + 1}`), result));
  if (commands) writeFileSync(path.join(root, 'commands'), JSON.stringify(commands));
  const args = [`tools/ci/smoke-${platform}.sh`];
  if (platform === 'ios') args.push('Sample.app');
  const { status, error } = spawnSync('bash', [...args, evidence], {
    cwd: path.resolve(__dirname, '..'),
    env: {
      ...process.env,
      MOCK_ROOT: root,
      ANDROID_SERIAL: serial,
      PATH: root + path.delimiter + process.env.PATH,
      GITHUB_STEP_SUMMARY: path.join(root, 'summary'),
    },
    timeout: 5000,
  });
  if (error) throw error;
  const calls = readFileSync(path.join(root, 'calls'), 'utf8').trim().split('\n');
  return { status, calls, maestro: calls.filter((line) => line.startsWith('maestro ')) };
}

function failedCommand(name, message) {
  return [{ command: { [name]: {} }, metadata: { status: 'FAILED', error: { message } } }];
}

describe.each(['android', 'ios'])('%s smoke', (platform) => {
  const driverError = platform === 'ios' ? iosTimeout : offline;
  const commands = platform === 'android' ? failedCommand('launchAppCommand', offline) : undefined;

  it('passes on the first attempt', () => {
    const { status, maestro } = run(platform, ['passed']);
    expect(status).toBe(0);
    expect(maestro).toHaveLength(1);
  });

  it('keeps evidence from both attempts when the driver recovers', () => {
    const { status, maestro, calls } = run(platform, [driverError, 'passed'], commands);
    expect(status).toBe(0);
    expect(maestro).toHaveLength(2);
    expect(readFileSync(path.join(evidence, 'attempt-1/junit.xml'), 'utf8').trim()).toBe(
      driverError,
    );
    expect(readFileSync(path.join(evidence, 'attempt-2/junit.xml'), 'utf8').trim()).toBe('passed');
    expect(readFileSync(path.join(evidence, 'junit.xml'), 'utf8').trim()).toBe('passed');
    expect(readFileSync(path.join(root, 'summary'), 'utf8')).toMatch(/passed/i);
    if (platform === 'ios') {
      for (const [index, call] of maestro.entries()) {
        const device = 'device-' + (index + 1);
        expect(call).toContain('--device ' + device + ' ');
        expect(calls).toContain('simctl install ' + device + ' Sample.app');
        expect(calls).toContain('simctl delete ' + device);
      }
      expect(calls.indexOf('simctl delete device-1')).toBeLessThan(calls.indexOf(maestro[1]));
    } else {
      expect(maestro.every((call) => call.includes('--device ' + serial + ' '))).toBe(true);
      expect(calls).toContain('adb -s ' + serial + ' shell getprop sys.boot_completed');
    }
  });

  it('fails after a second driver error', () => {
    const { status, maestro } = run(platform, [driverError, driverError], commands);
    expect(status).toBe(1);
    expect(maestro).toHaveLength(2);
  });

  it('fails an assertion on the first attempt', () => {
    const { status, maestro } = run(platform, ['Assertion failed: camera-screen is missing']);
    expect(status).toBe(1);
    expect(maestro).toHaveLength(1);
  });
});

it.each([
  ['assertConditionCommand', offline],
  ['launchAppCommand', 'Command failed (host:transport:emulator-5556): device offline'],
])('rejects Android retry for %s reporting %s', (name, error) => {
  const { status, maestro } = run('android', [error], failedCommand(name, error));
  expect(status).toBe(1);
  expect(maestro).toHaveLength(1);
});

it('stops if the selected emulator is still offline after 30 seconds', () => {
  mockCommand('timeout', 'echo "wait $2" >> "$MOCK_ROOT/calls"; exit 124');
  const { status, calls, maestro } = run(
    'android',
    [offline],
    failedCommand('launchAppCommand', offline),
  );
  expect(calls).toContain('wait 30s');
  expect(status).toBe(1);
  expect(maestro).toHaveLength(1);
});
