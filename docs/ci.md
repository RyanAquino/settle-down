# Quality checks

`Quality gate` is the stable status check for pull requests, main-branch pushes,
and merge queues. It requires formatting, whole-repository lint, TypeScript,
app tests with coverage, verification-tool tests, Knip, workflow validation,
Expo dependency/health checks, iOS and Android production bundles, secret scanning,
and dependency review where applicable.

## Run locally

Use the Node version in `.nvmrc`. From a fresh checkout:

```sh
npm ci
npm ci --prefix tools/verify-ios --ignore-scripts --omit=dev
npm run check
CI=1 EXPO_NO_DOTENV=1 npm run check:dependencies
CI=1 EXPO_NO_DOTENV=1 npm run check:expo
```

The tooling tests start a localhost fixture server. An execution sandbox must
allow localhost binding. `npm run format` applies the shared formatting baseline;
CI only checks formatting. `npm run lint:fix` applies safe ESLint fixes.

For production bundle verification, supply an explicit synthetic environment:

```sh
export CI=1 EXPO_NO_DOTENV=1
export EXPO_PUBLIC_API_BASE_URL=https://ci.invalid
export EXPO_PUBLIC_AUTH_TOKEN=''
export EXPO_PUBLIC_SHOW_DEBUG_SKIP_BUTTON=false
npm run bundle:ios
npm run bundle:android
```

Workflow and secret checks use checksum-verified tools. The installer supports
Linux x64 and macOS arm64:

```sh
bash tools/ci/install-tool.sh actionlint /tmp/settle-quality-bin
bash tools/ci/install-tool.sh gitleaks /tmp/settle-quality-bin
/tmp/settle-quality-bin/actionlint \
  -ignore 'unknown permission scope "copilot-requests"' \
  -ignore 'unexpected key "cache-mode" for "job" section'
/tmp/settle-quality-bin/gitleaks git --redact --no-banner
```

Actionlint 1.7.12 needs two targeted exceptions for GitHub Actions features
used by the iOS verifier. Remove each exception when a pinned release recognizes
the `copilot-requests` permission or the job-level `cache-mode` key.
Gitleaks scans committed history and redacts findings.

## What the suites cover

Jest uses the Expo SDK 58 preset and RNTL 14. Read the installed RNTL documentation
before changing component tests; rendering and interactions are asynchronous.
The receipt suite covers line-total arithmetic, tax, stable item identity,
member/shared allocations, currencies, and invalid receipt input. Retry tests
cover backoff and exhaustion. Component tests exercise receipt edits, assignments, sharing, inbox recovery, and submission outcomes.

Coverage includes untested app screens so the report does not suggest that the
whole app is covered. Only `utils/receipt.ts` currently has blocking thresholds
(95% statements/lines, 90% branches, 100% functions). Raise coverage by testing
behaviors and failure paths rather than adding snapshots to meet a percentage.
Reports are stored under `coverage/` and `test-results/` and retained for seven days
in GitHub Actions.

Knip analyzes the app and the separate `tools/verify-ios` package. Its only
exceptions are the externally installed `eas` CLI and the pinned `@github/copilot`
package, invoked dynamically by the verification runner. Workflow entry points
and Node test entry points are explicitly included. New unused dependencies fail.

## Native builds and smoke tests

`Native smoke` builds iOS and Android Release binaries and runs the committed
`.maestro/launch.yaml` flow on a simulator/emulator. It checks that the real native
app launches and exposes the camera screen controls, with permissions granted.
Android also runs `lintRelease`. No signing account, real backend, or production
credential is used; OTA loading is disabled with `CI_E2E=1`.

The iOS simulator starts after npm installation and cache restoration so it can
boot while Expo builds. Xcode can reuse individual Swift and Clang compilations,
and CocoaPods shares its download cache with the iOS verifier. Maestro uses
the fresh iOS install directly to keep its camera permission grant in place.
Android caches Gradle task outputs and the CMake compiler results for all four
architectures. The Android evidence includes Gradle's task timing report. Both
jobs regenerate the native project and package the current checkout. GitHub stores the compiler and task results
after a successful build so they are available if the device test needs a rerun.

The smoke flow can retry once on each platform. On Android, a failed
`launchApp` command must report that the selected emulator went offline.
CI waits up to 30 seconds for its ADB shell to respond before retrying.
On iOS, Maestro has four minutes to start its XCTest driver. If that startup
times out, CI installs the same binary on a fresh simulator for the retry.
An assertion failure ends the job immediately. The native evidence artifacts
keep each attempt, and a successful retry is recorded in the job summary.

Pull requests that change app code, bundled assets, native modules, the iOS project,
build configuration, dependencies, or smoke tooling run the iOS smoke test.
Both platforms run on every push to `main` and can also be run manually.
macOS builds can take substantially longer than the Linux quality checks.
The iOS runner/Xcode combination follows the existing verification workflow.
Update both together when runner images change.

This smoke test does not validate physical camera capture, OCR, offline recovery,
or a complete transaction. The existing `/verify` workflow adds PR-specific
exploration against synthetic backend fixtures. Review and commit additional
regression flows as those paths are implemented; use real devices for hardware
and production-like integration checks.

Do not make this path-filtered workflow universally required: GitHub can leave
its check pending on unrelated PRs. `Quality gate` always runs without path
filters and is suitable for a required rule.

## Security and dependency maintenance

Dependency review blocks newly introduced high/critical advisories in PRs and
merge queues. It is not a clean bill of health for pre-existing dependencies.
CodeQL runs separately on PRs, main, and weekly, with results in GitHub code
scanning. Review code-scanning alerts; successful analysis execution does not mean
there are no findings. Dependabot alerts track vulnerable dependencies. Review and
update npm dependencies and GitHub Actions manually. Expo/runtime upgrades must
pass Expo compatibility checks before merging.

The initial cleanup removed unused native packages and the vulnerable unused
ngrok beta. Moderate/low transitive audit findings remain; do not use a forced
major-version audit fix without testing Expo compatibility. Keep `.npmrc` in sync
with lockfile generation (`legacy-peer-deps=true` currently).

Actions use immutable commit SHAs. Downloaded actionlint, Gitleaks, and Maestro
archives have fixed checksums. Update versions and checksums together from the
maintainers' official releases. PR jobs have no application secrets or publishing
credentials; privileged iOS reporting remains separate from executing PR code.

## Merge checks and release implications

The main branch requires `Quality gate` and `iOS PR Verification`. For changes that affect the app, request the latter with a `/verify` comment on the PR. The applicability workflow records exemptions for changes outside the app and its build settings.

Create fresh native builds when native dependencies change. The `appVersion` runtime policy uses the app version for OTA compatibility. Bump it when a new update requires a different native runtime so existing binaries keep receiving compatible updates.

Public Expo environment values are embedded in the application. The existing
`EXPO_PUBLIC_AUTH_TOKEN` must not contain a private service credential; CI uses
an empty value. Authentication design and production observability are separate
follow-up work, not claims made by these checks.
