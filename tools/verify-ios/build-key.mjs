import { appendFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from './process.mjs';
import { buildCacheKey } from './build-config.mjs';

const source = path.resolve(process.argv[2]);
const root = path.dirname(fileURLToPath(import.meta.url));
const tree = (await run('git', ['rev-parse', 'HEAD^{tree}'], { cwd: source })).output.trim();
const tooling = createHash('sha256');
for (const file of ['build.mjs', 'build-artifact.mjs', 'build-config.mjs', 'build-key.mjs', 'process.mjs', 'fixture-control.mjs', 'policy.mjs', 'package-lock.json', '../../.github/workflows/verify-ios.yml']) {
  tooling.update(file).update(await readFile(path.join(root, file)));
}
const xcode = (await run('xcodebuild', ['-version'])).output.trim();
const key = buildCacheKey({ tree, toolingHash: tooling.digest('hex'), xcode, nodeMajor: process.versions.node.split('.')[0] });
await appendFile(process.env.GITHUB_OUTPUT, `key=${key}\n`);
