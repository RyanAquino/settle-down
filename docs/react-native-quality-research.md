**React Native quality and CI research — Settle Down**

Researched November 16, 2026, using official framework documentation and tool-maintainer sources. Recommendations are tailored to this repository; priorities and proposed policies below are engineering judgments, not universal requirements.

The recommended starting stack is **strict TypeScript + Expo ESLint with typed rules + Prettier + Expo Doctor + Jest/React Native Testing Library + Maestro**, with GitHub Actions running the fast checks automatically. Add Knip and security scanning after establishing that baseline. Keep the existing iOS exploration workflow as supplemental coverage.

**What is already here**

| Area                | Repository evidence                                                                                                                                          | Assessment                                                                                                                    |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| Runtime             | [package.json](../package.json): Expo SDK 58, React Native 0.88.1, React 19.3, TypeScript 6                                                                  | Use documentation and dependencies compatible with these versions.                                                            |
| Types               | [tsconfig.json](../tsconfig.json): `strict: true`; `type-check` runs `tsc --noEmit`                                                                          | Good baseline. A successful Metro build does not replace type checking.                                                       |
| Lint                | [eslint.config.js](../eslint.config.js): Expo flat config                                                                                                    | Effective config already includes Hooks and React Compiler rules. Type-aware TypeScript linting is not enabled.               |
| Formatting          | No formatter dependency or configuration found                                                                                                               | Add one formatter and a CI check.                                                                                             |
| App tests           | No Jest configuration or app unit/component tests found                                                                                                      | Highest-value testing gap.                                                                                                    |
| CI tooling tests    | [tools/verify-ios](../tools/verify-ios/README.md) has 40 Node tests and a synthetic backend                                                                  | Reuse these fixtures and run the tooling tests automatically.                                                                 |
| Native verification | [verify-ios.yml](../.github/workflows/verify-ios.yml) is comment-triggered; [report workflow](../.github/workflows/verify-ios-report.yml) reports completion | Useful iOS Release-build verification. No automatic PR workflow or Android verification workflow is present in this checkout. |
| E2E coverage        | Existing runner explores PR changes and replays generated Maestro scenarios                                                                                  | It explicitly has no mandatory whole-app smoke test. Commit a small regression suite as well.                                 |
| OTA updates         | [app.json](../app.json) uses the `appVersion` runtime policy                                                                                                 | Native compatibility needs an explicit release check.                                                                         |

GitHub rulesets, hosted scan settings, remote CI results, and whether the comment-triggered workflow is activated on the default branch were not inspected.

**Local verification performed**

| Command                                        | Observed result                                                                                                                               |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `CI=1 npm run lint -- --no-cache`              | Passed.                                                                                                                                       |
| `npm run type-check`                           | Passed.                                                                                                                                       |
| `CI=1 ./node_modules/.bin/eslint . --no-cache` | 20 errors in `tools/verify-ios`: Node `Buffer` globals and MCP import resolution. The existing app lint command has a narrower default scope. |
| `npm test --prefix tools/verify-ios`           | 38 passed; 2 failed at localhost server binding with sandbox `EPERM`. Those two results do not establish application or test defects.         |

These checks used the installed dependencies, not a fresh CI installation. Repository observations and check results are a snapshot from this research run. No native builds, Expo Doctor run, vulnerability scan, or production integration test was performed. This research task only added this document; application and CI configuration were not edited.

**Checks to require on every pull request**

| Check                     | Tool and intended command                                                                           | Purpose / adoption detail                                                                                                                                       |
| ------------------------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reproducible installation | `npm ci`; install the tooling package separately                                                    | Detect lockfile drift. Use one Node version across local development and CI, and cache npm downloads using both lockfiles.                                      |
| Type checking             | `npm run type-check`                                                                                | Keep strict mode. Validate from a clean checkout, including any generated route types the project relies on.                                                    |
| Linting                   | ESLint with Expo flat config and `--max-warnings=0`                                                 | Cover app, utilities, config, and Node tooling with appropriate environment overrides. Fix the tooling configuration before expanding the required lint scope.  |
| Formatting                | `prettier --check .`                                                                                | Ignore generated/native build outputs. Format locally; CI should check without rewriting files.                                                                 |
| App tests                 | Jest with `jest-expo`, plus React Native Testing Library                                            | Run in CI mode, publish coverage and test results, fail when expected tests are missing.                                                                        |
| CI-tool tests             | `npm test --prefix tools/verify-ios`                                                                | The verification runner and fixture backend are production tooling worth protecting.                                                                            |
| Workflow validation       | `actionlint`                                                                                        | Check workflow expressions, job references, and embedded shell. Existing docs describe one narrow compatibility exception; recheck it when updating actionlint. |
| Expo compatibility        | `CI=1 npx expo install --check`; pinned `expo-doctor`                                               | Validate SDK-compatible packages, app configuration, and package health. Establish a documented baseline for third-party metadata findings.                     |
| Production JS bundling    | `expo export --platform ios` and `expo export --platform android`, with separate output directories | Catch platform resolution, Metro, assets, and production-transform failures. This does not compile native binaries. Use synthetic CI environment values.        |

These are proposed checks: several tools/scripts are not installed yet. Install and lock CI tools in the repository rather than downloading an unpinned `latest` on each run. Run independent checks in parallel where that improves feedback; aim for a fast Linux lane before spending macOS build time. Workflow linting capabilities are documented in the [actionlint repository](https://github.com/rhysd/actionlint).

Expo documents immutable compatibility checking with `CI=1`; its Doctor checks configuration and dependency health. `npm ci` requires consistent installation flags with the lockfile. This repository sets `legacy-peer-deps=true`, so retain that setting during initial CI adoption, then investigate whether it can be removed with a tested dependency update. [Expo CLI](https://docs.expo.dev/more/expo-cli/), [Expo Doctor](https://docs.expo.dev/develop/tools/), [npm ci](https://docs.npmjs.com/cli/v11/commands/npm-ci/)

**Lint and type rules with the best return**

Keep `eslint-config-expo/flat`. Add typescript-eslint's `recommendedTypeChecked` configuration with `parserOptions.projectService: true`, scoped to TypeScript files covered by the project's tsconfig. Do not apply typed parsing indiscriminately to standalone `.mjs` tooling. Typed linting costs more than syntax-only linting but can identify errors the compiler accepts. [Typed linting](https://typescript-eslint.io/getting-started/typed-linting/)

Prioritize `no-floating-promises`, `no-misused-promises`, and the recommended `no-unsafe-*` rules. Add `switch-exhaustiveness-check` for discriminated unions where useful. At JSON/API boundaries, validate `unknown` values before treating them as application types; a type annotation on `JSON.parse()` does not validate its contents. Adopt stricter rules incrementally, with narrowly explained exceptions for genuine native-library typing limitations.

The installed Expo config already enables compiler-related rules such as `immutability`, `refs`, `purity`, and `set-state-in-render`. Keep these and Hooks dependency checking; inspect the effective config before adding duplicate plugins. React documents that compiler diagnostics are available through `eslint-plugin-react-hooks` even without enabling the compiler itself. [React Hooks ESLint plugin](https://react.dev/reference/eslint-plugin-react-hooks)

Consider `noUncheckedIndexedAccess` next: this app indexes assignments by `item_order`, where a missing key is meaningful. Evaluate `exactOptionalPropertyTypes` separately so its migration cost is visible. Neither setting is a substitute for validating server responses. [Indexed access checking](https://www.typescriptlang.org/tsconfig/noUncheckedIndexedAccess.html), [Exact optional properties](https://www.typescriptlang.org/tsconfig/exactOptionalPropertyTypes.html)

Use Prettier as a separate command and put `eslint-config-prettier` after conflicting style rules. This avoids making formatting another ESLint execution path. [Prettier integration guidance](https://prettier.io/docs/integrating-with-linters)

**Testing strategy for this app**

Use **Jest + `jest-expo` + React Native Testing Library**. Expo's preset handles much of the native mocking setup. Follow the installed testing library's version-specific documentation: the current RNTL 14 documentation uses the `test-renderer` peer dependency, whereas older tutorials use deprecated `react-test-renderer`. Do not mix setup instructions across majors. [Expo Jest setup](https://docs.expo.dev/develop/unit-testing/), [RNTL quick start](https://oss.callstack.com/react-native-testing-library/docs/start/quick-start)

Extract the receipt calculations, payload construction, response parsing, and retry decisions into small functions outside the screen. Test behavior and invariants, including:

1. Item `cost` is already the line total; quantity must not multiply it again.
2. Tax, edited costs, shared assignments, and member assignments produce the intended payload and total.
3. State stays associated with `item_order` when items are reordered.
4. Selected-group currency controls formatting; cover JPY, TWD, HKD, and no selected currency.
5. Invalid route data or malformed API responses produce a controlled error state.
6. Camera-photo and library-photo offline paths follow their distinct recovery rules.
7. Upload failures stop after the intended attempts; cancellation prevents stale work from changing screens.
8. Repeated taps cannot create concurrent transaction submissions. Specify backend idempotency behavior before retrying transaction POSTs after ambiguous network failures.

For component tests, cover loading, empty, error, retry, and success states. Query by accessible role/name or visible text and exercise user interactions. Mock native boundaries and network responses deliberately; avoid mocking the very calculation or state transition under test. Prefer targeted assertions to large snapshots. React Native's testing guide also explains that JavaScript component tests do not exercise native iOS/Android implementations. [React Native testing](https://reactnative.dev/docs/testing-overview)

Start coverage reporting with explicit inclusion of the business-logic files, including untested ones. Set thresholds after meaningful tests exist; focus on branches in calculations and recovery paths. A blanket percentage can reward shallow tests and should not be the main acceptance criterion.

For E2E, **keep Maestro**. It already fits this repo and can drive both iOS and Android through native accessibility information without adding an instrumentation package to the app. Detox is a reasonable alternative when its app-aware synchronization and JavaScript test API solve a specific problem; adopting both now would add maintenance. [Maestro React Native support](https://docs.maestro.dev/get-started/supported-platform/react-native), [Detox approach](https://wix.github.io/Detox/docs/introduction/getting-started/)

Commit a small, deterministic Maestro suite: launch and permissions; select a seeded receipt and complete assignment/sync; recover from upload or sync failure. Reuse the existing synthetic backend, reset app and fixture state per scenario, and assert submitted request contents as well as visible success. Keep fixtures aligned with the real backend contract. Save screenshots, video, device logs, and JUnit output on failure. Promote useful generated `/verify` flows into reviewed regression tests.

**When to run native and slower checks**

| Stage                             | Recommended policy                                                                                                                                   |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Every PR                          | Fast checks above. Run deterministic native smoke tests on app changes once their cost and stability are acceptable.                                 |
| Native-affecting changes          | Build both platforms for dependency/lockfile, Expo config, config-plugin, native-source, and build-setting changes. Exercise the resulting binaries. |
| Main branch / nightly             | Broader iOS and Android regression suite, native build validation, scheduled dependency/security scanning.                                           |
| Before release or OTA publication | Validate the exact intended artifact and environment; verify update compatibility, real-device behavior, and monitoring setup.                       |

Until native smoke tests run on every relevant PR, label the reduced coverage explicitly. A nightly run detects issues after merge; it does not provide a pre-merge guarantee. Keep comment-triggered exploration supplemental because it depends on a person requesting it and generated scenario selection.

Stay with GitHub Actions for now. Expo Workflows is an alternative if maintaining mobile runners becomes burdensome; it supports builds, updates, and Maestro jobs. There is no need to migrate providers to add the missing checks. [Expo Workflows](https://docs.expo.dev/eas/workflows/introduction/), [Maestro workflow example](https://docs.expo.dev/eas/workflows/examples/e2e-tests)

Require stable check names through repository rules. Trigger the fast workflow on `pull_request` and main-branch pushes; add `merge_group` if using a merge queue. Avoid path filters that prevent a required workflow from reporting a result. Cancel superseded runs, set timeouts, and retain useful failure evidence. [GitHub required-check behavior](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks)

**Additional analyzers, in priority order**

| Tool                                   | Useful coverage                                                 | Recommendation                                                                                                                                                                                            |
| -------------------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Knip                                   | Unused dependencies, exports, and files                         | Add after the baseline. Its Expo/Expo Router plugins recognize framework entry points. Configure the separate CI-tool package and intentional native/config dependencies before making findings blocking. |
| CodeQL                                 | Security analysis of application and tooling code               | Enable if repository eligibility permits; use a focused initial ruleset and triage findings.                                                                                                              |
| Dependency review + dependency updater | Vulnerable newly introduced dependencies and regular update PRs | Cover both npm lockfiles and GitHub Actions. Keep Expo/React Native upgrade groups compatible.                                                                                                            |
| Gitleaks                               | Accidentally committed secrets                                  | A useful CI/pre-commit option; redact findings and use narrow reviewed exceptions.                                                                                                                        |
| dependency-cruiser                     | Import cycles and prohibited architectural dependencies         | Add when module boundaries become meaningful; ordinary code review is sufficient for the current small structure.                                                                                         |
| SonarQube                              | Centralized analysis and quality reporting                      | Optional if the team wants a shared reporting platform. It consumes coverage produced by Jest; it does not create that coverage.                                                                          |

Sources: [Knip](https://knip.dev/), [Expo Router plugin](https://knip.dev/reference/plugins/expo-router), [CodeQL](https://docs.github.com/en/code-security/concepts/code-scanning/codeql/codeql-code-scanning), [dependency review](https://docs.github.com/en/code-security/concepts/supply-chain-security/dependency-review), [Gitleaks](https://github.com/gitleaks/gitleaks), [dependency-cruiser](https://github.com/sverweij/dependency-cruiser/blob/main/doc/rules-reference.md), [SonarQube coverage](https://docs.sonarsource.com/sonarqube-cloud/analyzing-source-code/test-coverage/javascript-typescript-test-coverage).

GitHub security feature availability depends on repository visibility and plan. Check entitlement before making a hosted scanner part of the required design. Review newly introduced severe vulnerabilities promptly and track existing findings with owners; avoid automatic forced dependency upgrades that bypass Expo compatibility testing.

Biome and Oxlint are viable tooling candidates, but I would retain the existing ESLint integration here. Consider switching only after measuring a bottleneck and verifying the required Expo, React Compiler, typed-rule, and test-rule coverage. [Biome rule mappings](https://biomejs.dev/linter/rules-sources/), [Oxlint documentation](https://oxc.rs/docs/guide/usage/linter.html)

For custom native code, add Android Lint and appropriate native tests; SwiftLint becomes useful if the project owns Swift source. Keep lint configuration focused on maintained source rather than generated projects or vendored dependencies. [Android Lint](https://developer.android.com/studio/write/lint), [SwiftLint](https://github.com/realm/SwiftLint)

**Quality beyond lint and tests**

- **Accessibility:** Test VoiceOver and TalkBack, labels, roles, selected/disabled states, focus order, large text, contrast, reduced motion, and touch targets. Component assertions are helpful but cannot prove the screen-reader experience. [React Native accessibility](https://reactnative.dev/docs/accessibility)
- **Performance:** Profile startup, long receipts, image memory, and navigation on representative physical devices using Release builds. Use React Native DevTools for React/JS investigation and platform tools for native behavior. [Performance guidance](https://reactnative.dev/docs/performance), [DevTools](https://reactnative.dev/docs/react-native-devtools)
- **Bundle growth:** Use Expo Atlas to explain dependency and bundle changes. Record platform-specific baselines before choosing regression budgets; bundle size alone does not measure startup or memory. [Expo Atlas](https://docs.expo.dev/guides/analyzing-bundles/)
- **Visual behavior:** Review a few stable screens across light/dark mode, larger fonts, keyboard visibility, and screen sizes. Treat screenshot differences as review evidence until baselines and rendering conditions are stable.
- **Production feedback:** Add crash/error monitoring such as Sentry and verify source maps for both native releases and OTA updates. Track upload and sync failures without logging receipt images, credentials, or personal transaction data. [Expo Sentry guide](https://docs.expo.dev/guides/using-sentry/)
- **Hardware/integration validation:** Test physical camera capture, permission denial/recovery, app backgrounding, real OCR, and a controlled Settle Up integration. The existing simulator fixture suite explicitly cannot validate these.

Two repository-specific release checks deserve attention. First, the app reads `EXPO_PUBLIC_AUTH_TOKEN`. If that value is intended to be a secret, the design must change: Expo inlines public variables into the downloadable application. Secret storage in CI does not hide a value subsequently embedded in the app. Second, the `appVersion` runtime policy requires disciplined version changes for native incompatibilities; evaluate Expo's `fingerprint` policy or enforce an equivalent compatibility check. [Expo environment variables](https://docs.expo.dev/guides/environment-variables/), [Runtime compatibility](https://docs.expo.dev/eas-update/runtime-versions/), [Runtime policies](https://docs.expo.dev/versions/latest/sdk/updates/)

For CI itself, preserve the existing separation between untrusted PR code and privileged reporting. Use minimum token permissions, immutable action commit SHAs, and secrets only in trusted release jobs. Checks should run against the relevant PR commit or merge result and identify exactly which revision produced artifacts. [GitHub Actions security guidance](https://docs.github.com/en/actions/reference/security/secure-use)

**Suggested implementation order**

1. Add automatic PR type checking, linting, workflow validation, and existing tooling tests. Correct Node-tool lint scope and resolution. Add Prettier and required check rules.
2. Enable typed linting and Expo compatibility/bundle checks. Add focused unit and component tests for receipt logic, API handling, and recovery behavior.
3. Add committed Maestro smoke flows and Android build/test coverage, reusing the fixture backend.
4. Add Knip, dependency/security scanning, crash monitoring, and release compatibility checks. Set performance and visual budgets after collecting stable baselines.

Each phase should leave checks reproducible locally, failures actionable, and the next release easier to assess.
