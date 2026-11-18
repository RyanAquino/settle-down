import { fixtureControl } from './fixture-control.mjs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { APP_ID, validateFlow } from './policy.mjs';

export const cameraRegressions = [
  {
    id: 'camera-zoom-bounds', name: 'Camera zoom bounds, Reset, and foreground lifecycle', fixture: 'success',
    coverage: 'Checks minimum disabled states, twenty zoom steps to the maximum and disabled Zoom in, Reset to zero, and a fresh zero-zoom session after Home/resume.',
    yaml: `appId: ${APP_ID}
name: Camera zoom bounds and lifecycle
---
- launchApp:
    permissions:
      all: allow
- assertVisible: Point at a receipt
- assertVisible:
    text: Zoom out
    enabled: false
- assertVisible:
    text: Reset zoom
    enabled: false
${'- tapOn: Zoom in\n'.repeat(20)}- assertVisible:
    text: Zoom in
    enabled: false
- assertVisible:
    text: Zoom out
    enabled: true
- tapOn: Reset zoom
- assertVisible:
    text: Zoom out
    enabled: false
- assertVisible:
    text: Reset zoom
    enabled: false
- tapOn: Zoom in
- pressKey: Home
- launchApp:
    stopApp: false
    permissions:
      camera: allow
- assertVisible: Point at a receipt
- assertVisible:
    text: Zoom out
    enabled: false
- assertVisible:
    text: Reset zoom
    enabled: false
- takeScreenshot: camera-zoom-bounds
`,
  },
  {
    id: 'camera-settings-recovery', name: 'Native Settings camera permission recovery', fixture: 'success',
    coverage: 'Explicit denial shows Open settings; navigate Settings root/Apps/app details, verify the Camera switch is off, toggle that switch on, and resume to enabled camera controls.',
    yaml: `appId: ${APP_ID}
name: Native camera permission recovery
---
- launchApp:
    permissions:
      all: allow
      camera: deny
- assertVisible: Camera access
- assertVisible: Open settings
- tapOn: Open settings
- runFlow:
    when:
      visible:
        id: Settings
    commands:
      - scrollUntilVisible:
          element:
            id: com.apple.settings.apps
          direction: DOWN
      - tapOn:
          id: com.apple.settings.apps
- runFlow:
    when:
      visible: Search Apps
    commands:
      - scrollUntilVisible:
          element:
            text: Settle Down
          direction: DOWN
      - tapOn:
          id: com.ryan.aquino.settledown
- assertVisible:
    id: Camera
    checked: false
- tapOn:
    id: Camera
    checked: false
    point: "90%,50%"
- assertVisible:
    id: Camera
    checked: true
- pressKey: Home
- launchApp:
    stopApp: false
    permissions:
      camera: allow
- assertVisible: Point at a receipt
- assertVisible:
    text: Zoom in
    enabled: true
- takeScreenshot: camera-permission-recovered
`,
  },
];

export function cameraRegressionsApply(changedFiles) {
  return changedFiles.some(file => ['app/camera.tsx', 'components/camera-session.tsx'].includes(file));
}

export async function runCameraRegressions({ udid, appPath, evidence, token, run, resetScenario, checkJUnit, signal, initialResetReady = false, resetFixture = fixtureControl }) {
  const records = [];
  for (const scenario of cameraRegressions) {
    validateFlow(scenario.yaml, { replay: true });
    const directory = `${evidence}/regressions/${scenario.id}`;
    await mkdir(directory, { recursive: true });
    await writeFile(`${directory}/flow.yaml`, scenario.yaml);
    const record = { scenario, status: 'BLOCKED', evidencePath: `regressions/${scenario.id}/` };
    console.log(`Starting required camera regression: ${scenario.id}`);
    // Hosted XCTest startup consumed almost two minutes before the first
    // assertion. Bound startup and the complete unchanged flow together.
    const deadline = Date.now() + 360000;
    try {
      const resetSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(180000)]) : AbortSignal.timeout(180000);
      if (initialResetReady && records.length === 0) {
        await resetFixture('/__reset', { token, body: { preset: scenario.fixture, phase: scenario.id }, signal: resetSignal });
      } else {
        await resetScenario({ udid, appPath, appId: APP_ID, fixture: scenario.fixture, phase: scenario.id, token, signal: resetSignal });
      }
      const execution = await run('maestro', ['--device', udid, 'test', '--format', 'junit', '--output', `${directory}/junit.xml`,
        '--debug-output', directory, '--test-output-dir', directory, `${directory}/flow.yaml`],
      { timeout: Math.max(1, deadline - Date.now()), allowFailure: true, log: `${directory}/maestro.log` });
      record.exitCode = execution.code;
      if (execution.timedOut) record.error = 'Required regression exceeded its six-minute startup and execution budget';
      const junit = await readFile(`${directory}/junit.xml`, 'utf8').catch(() => '');
      record.junitVerified = !!junit && checkJUnit(junit);
      record.status = execution.timedOut || !junit ? 'BLOCKED' : execution.code === 0 && record.junitVerified ? 'PASS' : 'FAIL';
    } catch (error) { record.error = error.message; }
    records.push(record);
    await writeFile(`${evidence}/regressions.json`, JSON.stringify(records, null, 2));
    console.log(`Required camera regression ${scenario.id}: ${record.status}`);
  }
  return records;
}
