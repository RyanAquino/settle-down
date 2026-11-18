import { writeFile } from 'node:fs/promises';

export const CI_RUNTIME = Object.freeze({
  identifier: 'com.apple.CoreSimulator.SimRuntime.iOS-26-5',
  version: '26.5',
});

export async function prepareRuntime({ run, evidence, runtime = CI_RUNTIME.identifier }) {
  const record = { identifier: runtime, status: 'preparing' };
  try {
    const core = (
      await run(
        'plutil',
        [
          '-extract',
          'CFBundleVersion',
          'raw',
          '-o',
          '-',
          '/Library/Developer/PrivateFrameworks/CoreSimulator.framework/Resources/Info.plist',
        ],
        { timeout: 15000 },
      )
    ).output.trim();
    record.coreSimulator = core;
    if (!/^\d+(\.\d+)*$/.test(core))
      throw new Error(`Could not determine the CoreSimulator version: ${core || 'empty'}`);

    const list = await run('xcrun', ['simctl', 'list', 'runtimes', '-j'], {
      timeout: 180000,
      log: `${evidence}/runtime-list.log`,
    });
    const installed = JSON.parse(list.output).runtimes.find(
      (r) => r.identifier === runtime && r.isAvailable,
    );
    if (!installed)
      throw new Error(`Required simulator runtime ${runtime} is unavailable on this runner`);
    if (runtime === CI_RUNTIME.identifier && installed.version !== CI_RUNTIME.version)
      throw new Error(
        `Expected iOS ${CI_RUNTIME.version}; found ${installed.version} (${installed.buildversion})`,
      );
    if (typeof installed.buildversion !== 'string' || !installed.buildversion.trim())
      throw new Error(`Runtime ${runtime} is missing its build metadata`);

    record.version = installed.version;
    record.build = installed.buildversion;
    record.status = 'ready';
    console.log(
      `Simulator runtime ready: ${installed.version} (${installed.buildversion}), CoreSimulator ${core}`,
    );
    return record;
  } catch (error) {
    record.status = 'blocked';
    record.error = error.message;
    throw error;
  } finally {
    await writeFile(`${evidence}/runtime-preparation.json`, JSON.stringify(record, null, 2));
  }
}
