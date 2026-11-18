import { createHash } from 'node:crypto';

export const BUILD_ARCH = 'arm64';
const BUILD_CACHE_VERSION = 'ios-release-arm64-v1';

export function buildCacheKey({ tree, toolingHash, xcode, nodeMajor }) {
  if (!/^[a-f0-9]{40}$/.test(tree)) throw new Error('Invalid source tree');
  if (!/^[a-f0-9]{64}$/.test(toolingHash)) throw new Error('Invalid tooling hash');
  const digest = createHash('sha256')
    .update(JSON.stringify({ tree, toolingHash, xcode, nodeMajor, arch: BUILD_ARCH }))
    .digest('hex');
  return `${BUILD_CACHE_VERSION}-${digest}`;
}

export function releaseBuildArgs({ workspace, scheme, derivedData }) {
  return [
    '-workspace',
    workspace,
    '-scheme',
    scheme,
    '-configuration',
    'Release',
    '-sdk',
    'iphonesimulator',
    '-destination',
    'generic/platform=iOS Simulator',
    '-derivedDataPath',
    derivedData,
    '-showBuildTimingSummary',
    `ARCHS=${BUILD_ARCH}`,
    'ONLY_ACTIVE_ARCH=YES',
    'CODE_SIGNING_ALLOWED=NO',
    'COMPILER_INDEX_STORE_ENABLE=NO',
    'build',
  ];
}
