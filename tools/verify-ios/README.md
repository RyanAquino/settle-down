# Comment-triggered iOS verification

Post a new PR conversation comment containing exactly `/verify` (surrounding
whitespace is fine). Repository writers, maintainers, and admins can request runs
on open PRs whose head branch belongs to this repository. Fork PRs, edited comments,
review-line comments, bots, and commands with arguments are not accepted.

The workflow captures the PR head SHA. Another request for that SHA while it is
running links to the existing run. After completion, post a new `/verify` to test
the latest head. GitHub's **Re-run failed jobs** retains the original captured SHA
and reuses earlier build artifacts while they remain available. Completed results
explicitly identify stale commits.

When a run finishes, the bot posts a separate **Final verdict** PR comment with
the captured commit, scenario coverage and outcomes, failure/blocker details, and
evidence downloads (recording, screenshots, test plan, JUnit results, and logs when
available). PASS means working in the tested scenarios; FAIL means a replay failed;
BLOCKED or CANCELLED means untestable; SKIPPED means no simulator-verifiable iOS UI
change. Behavior that needs a physical device is listed separately and never blocks.
Missing evidence is explicit. The original progress comment links to the verdict.
Re-publishing the same attempt updates its final comment without duplicating it;
a new verification attempt posts a new final comment.

Rerun reports link evidence and check details from the current attempt, while
retaining the most recent reused build and original request artifacts. Missing
current evidence is never replaced with an older recording or test log.

## Activation

1. Merge the workflow files and tooling onto `main`. Both `issue_comment` and
   `workflow_run` require the workflows on the default branch. This local change
   does not activate CI until it is on `main`.
2. Enable GitHub Actions and Copilot Free for the repository owner. Copilot CLI
   uses `GITHUB_TOKEN` with `copilot-requests: write`; no PAT, Expo token, Apple
   signing account, backend secret, or OpenAI API key is required.
3. Rebase the PR being tested onto the setup commit so its app configuration
   supports `CI_E2E=1`. The build refuses a binary with OTA updates enabled.
4. Post `/verify` on a small, testable UI PR and inspect the resulting check,
   comment, and artifacts. Exercise an intentional assertion failure and a
   hardware-only change (expect PASS or SKIPPED with a physical-device list)
   before relying on this check for merge protection.

Copilot Free has a limited allowance. Exhausted allowance or authentication errors
produce BLOCKED; there is no paid-model or alternate-provider fallback. Standard
public-repository runners are used. Artifacts consume GitHub storage: evidence is
retained for seven days and the intermediate app archive for one day.

## What runs

- An authorization job uses the default-branch tooling to check current repository
  permission, record PR metadata, and create a check and progress comment.
- A separate macOS job builds the captured PR in Release mode. It has no Copilot
  or PR-writing permissions and executes no EAS cloud builds. `EXPO_NO_DOTENV=1`
  prevents local env files from supplying production credentials. The CI build
  uses `http://127.0.0.1:8765`, disables the debug shortcut, and disables OTA updates.
- A fresh macOS runner installs that binary, boots an iPhone 17 / iOS 26.5, seeds
  one synthetic receipt photo, and starts the fixture backend. Xcode 26.6, Node 22,
  Java 17, Maestro 2.12.1, and Copilot CLI 1.0.112 are selected explicitly.
- Copilot reads the diff and selected source through a restricted MCP adapter.
  Diffs, source, hierarchies, and fixture requests are paged so each tool result
  stays under 16,000 bytes. Copilot CLI writes larger results (over 20,480 bytes)
  to a temp file and shows the model only a 500-character preview, which the
  sandboxed agent cannot open.
  It sees screenshots and accessibility information and performs live UI actions.
  All navigation is validated literal Maestro YAML. It cannot run arbitrary shell
  commands, edit source, follow URLs, or load the PR's agent configuration.
- The agent saves up to three scenarios tied to the PR. CI reinstalls the app and
  resets the chosen backend preset before each independent replay. Exploration is
  bounded to 15 minutes / 100 tool calls; replay has a 10-minute shared budget.
- A separate completion workflow reads data artifacts, derives the verdict, and
  updates the check and posts a final verdict comment even when building/testing
  was cancelled. The progress comment links to that final verdict.
  It never checks out or executes PR code or downloaded artifacts.

The runner handles both `SIGINT` and `SIGTERM`. Cancellation stops detached command
groups (including stubborn descendants), writes the result before teardown, and
finalizes available recording/screenshots within a bounded cleanup window. An
unresponsive simulator command cannot prevent the cancellation report from being
written. Abrupt host loss or a direct `SIGKILL` can still leave partial evidence;
the independent completion workflow reports the run's GitHub conclusion.

Only PR changes are covered; there is no mandatory whole-app smoke test. Unchanged
screens are exercised only to reach changed behavior. PASS requires real replay,
positive assertions, a nonempty successful JUnit report, and no declared coverage
blockers. No simulator-verifiable iOS UI change is SKIPPED. Simulator/tool/quota
limitations outside the fixed camera harness exclusions below are BLOCKED. Executed failures are FAIL. Only PASS makes the check successful;
SKIPPED is neutral. No branch protection setting is changed automatically.

CI is simulator-only by design. Physical camera capture, image orientation,
autofocus, actual preview magnification, and haptics need a real device. The agent
lists those in `deviceOnly`; they appear in the verdict comment under
**Requires a physical device** and do not block. A PR whose simulator-observable
changes outside the fixed harness exclusions all pass is PASS; a PR with nothing observable in the simulator is SKIPPED.
Real OCR and real Settle Up integration are never exercised.

## Fixtures and evidence

The fixture service implements the app's existing receipt, groups, members, and
transaction endpoints. It supplies a fixed-date receipt with line totals (including
one quantity-two item), JPY/TWD/HKD groups, and synthetic Alex/Sam members. Presets:
`success`, `upload-error`, `groups-error`, `no-groups`, `users-error`, `sync-error`.
There is no upstream proxy. Transaction submissions are recorded locally only.

The agent's `submit_plan` tool accepts a disposition (`ready`, `skipped`, `blocked`),
rationale, limitations, `deviceOnly`, and scenarios (`id`, `name`, `coverage`,
`fixture`, `yaml`). `manualChecks` records only the fixed harness exclusions documented below.
Limitations are blocking simulator-side gaps and require
`blocked`; `blocked` requires at least one limitation.
Flows must start with `launchApp` and include `assertVisible` and `takeScreenshot`.
Unknown commands/options, scripts, nested flows, YAML aliases/tags, executable
expressions, optional assertions, alternate app IDs, and unsafe screenshot paths
are rejected before execution. The one allowed interpolation is `${APP_ID}` in
the header. Screenshots, evidence writes, and source reads are path constrained.

The evidence artifact contains `report.md`, `result.json`, `test-plan.md`,
`plan.json`, `generated/*.yaml`, `session.mp4`, initial/final and exploratory
screenshots, replay JUnit/logs, agent/tool-call logs, backend requests, PR context,
and tool versions. Build logs are a separate artifact. Missing evidence remains
explicit; the PR comment links downloads and does not embed video.

## Development checks

```sh
npm ci --prefix tools/verify-ios --ignore-scripts
npm test --prefix tools/verify-ios
npm run lint
npm run type-check
actionlint -ignore 'unknown permission scope "copilot-requests"' .github/workflows/verify-ios.yml .github/workflows/verify-ios-report.yml
```

The fixture tests bind an ephemeral local port. MCP protocol tests use only the
restricted adapter and synthetic files; they do not spend Copilot allowance.
Actionlint 1.7.12 predates the documented `copilot-requests` permission; the narrow
ignore above suppresses only that diagnostic, retaining all other checks.
The dependencies and lockfile are separate from the app. Update the pinned Maestro,
Copilot, and runner versions together after confirming their actual tool schemas
and replay output; a missing runtime or incompatible interface must stay BLOCKED.

## Camera coverage boundaries

`pressKey: Home` followed by `launchApp: { stopApp: false }` exercises background
and foreground without restarting the process. Lifecycle reset must be tested;
navigation and process termination are not substitutes.

The plan and result `manualChecks` field accepts only three fixed harness
exclusions: pinch-to-zoom (Maestro lacks two-finger gestures), camera mount-error
Retry, and camera capture-failure recovery (no native failure injection). These
are prominently reported as unverified manual checks and do not block a scoped
CI PASS. They are distinct from physical-device checks. All other coverage gaps,
setup/tool failures, and observed regressions remain blocking. Every PASS still
requires independently replayed assertions and successful JUnit evidence.

Deploy these trusted verifier changes to `main`, then request a fresh `/verify`.
Rerunning an old workflow attempt can retain the old trusted verifier revision.
