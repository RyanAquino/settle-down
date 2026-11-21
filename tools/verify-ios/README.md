# Comment-triggered iOS verification

For PRs targeting `main`, the `iOS PR Verification` check is automatically marked
skipped when the diff contains no app code, app assets, native iOS files, or app
build and dependency settings. Docs-only, GitHub-workflow-only, and test or
verification-tooling changes skip the simulator. A mixed PR with app changes
still uses `/verify`. The required check name in the `main` ruleset stays the same.

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
the captured commit, scenario coverage and outcomes, failure/blocker details,
and evidence downloads (recording, screenshots, test plan, JUnit results, and logs
when available). It also embeds captured screenshots and replay previews. PASS means working in the tested scenarios; FAIL means a replay failed;
BLOCKED or CANCELLED means untestable; SKIPPED means no simulator-verifiable iOS UI
change. Behavior that needs a physical device is listed separately and never blocks.
Missing evidence is explicit. The original progress comment links to the verdict.
Re-publishing the same attempt updates its final comment without duplicating it;
a new verification attempt posts a new final comment.

Rerun reports link evidence and check details from the current attempt, while
retaining the most recent reused build and original request artifacts. Missing
current evidence is never replaced with an older recording or test log.

## Activation

1. Merge the workflow files and tooling onto `main`. Comment requests and
   completion reports use default-branch workflows. The applicability workflow
   runs from the base branch when a PR is opened, updated, reopened, or retargeted
   to `main`.
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
  one synthetic receipt photo, and starts the fixture backend. The binary is built
  with Xcode 26.6. Both jobs use `macos-26` with Xcode 26.6. Node 22, Java 17,
  Maestro 2.12.1, and Copilot CLI 1.0.112 are selected explicitly.
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
  bounded to 25 minutes / 100 tool calls; each of up to three replays has ten minutes for reset, execution and JUnit output.
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
`success`, `missing-discount`, `upload-error`, `groups-error`, `no-groups`, `users-error`, `sync-error`, `out-of-order-members`.

The `missing-discount` preset omits the discount field on the full-price juice.
The two Onigiri have a paid line total of 200 and a discount of 30.

For the receipt inbox offline case, use the `success` fixture and tap **Import offline photo**
(`verify-import-offline`) on the camera screen. Pick the seeded photo. A `CI_E2E=1` build
supplies a disconnected NetInfo result for that import only. Assert **You’re offline**,
dismiss the alert, and assert **Scan receipt, Receipt photo** in the inbox. No receipt upload
should appear in the fixture requests until you open the queued photo. Tap it and assert
the receipt details to verify recovery. The regular library button uses device connectivity.
[Offline inbox replay](../../.maestro/receipt-inbox-offline.yaml) contains the Maestro assertions.

### Receipt reminders

Use the `success` fixture. Verification builds show **Test reminder in 8 seconds**
(`verify-receipt-reminder`) in the inbox once permission is granted and it contains at
least one receipt. The control sends a native notification for the current inbox and
leaves the regular three-hour and 9 AM schedules intact. Use **Home** to check delivery
in the background. The [photo reminder replay](../../.maestro/receipt-reminders.yaml)
opens the delivered alert and checks that the photo is scanned.

- On a clean install, leave a photo or split for later and decline the notification
  prompt. Check **Enable reminders**, save a second receipt, and check that no second
  prompt appears. Tap **Enable reminders**, allow notifications in Settings, and
  return to the app to see the test control.
- Save a split with the first item assigned. Trigger a reminder, tap the notification,
  and check that the first unassigned item is visible. Repeat with every item assigned
  and check that the summary is visible. For a stale tap, let the notification arrive,
  discard the receipt, then tap its delivered notification in Notification Center.
  Check **This receipt is no longer in your inbox.**
- Leave two receipts in the inbox. Trigger a reminder and check the grouped count and
  inbox destination. Repeat and immediately open one split before delivery. Only the
  other receipt should appear in the notification, and tapping it should open that
  receipt. With a single open receipt, the test notification should stay silent.

The out-of-order member preset gives Japan three members for uneven splits
and holds Taiwan’s member response until Hong Kong
returns Alex. Taiwan then returns Sam, making a stale overwrite visible in the payer list.
There is no upstream proxy. Transaction submissions are recorded locally only.

The agent's `submit_plan` tool accepts a disposition (`ready`, `skipped`, `blocked`),
rationale, limitations, `deviceOnly`, and scenarios (`id`, `name`, `coverage`,
`fixture`, `yaml`). `manualChecks` records only the fixed harness exclusions documented below.
Limitations are blocking simulator-side gaps and require
`blocked`; `blocked` requires at least one limitation.
Flows must start with `launchApp` and include `assertVisible` and `takeScreenshot`.
Unknown commands/options, scripts, file subflows, nested branches, YAML aliases/tags, executable
expressions, optional assertions, alternate app IDs, and unsafe screenshot paths
are rejected before execution. The one allowed interpolation is `${APP_ID}` in
the header. Screenshots, evidence writes, and source reads are path constrained.

The evidence artifact contains `report.md`, `result.json`, `test-plan.md`,
`plan.json`, `generated/*.yaml`, `session.mp4`, initial/final and exploratory
screenshots, replay JUnit/logs, agent/tool-call logs, backend requests, PR context,
and tool versions. Build logs are a separate artifact. Missing evidence remains
explicit. The full archive remains available alongside the inline previews.

### Inline screenshots and replay clips

The trusted report job selects up to four captured screenshots per scenario plus
a captured failure screenshot from that attempt’s Maestro journal. FFmpeg makes
a short H.264 clip around the last capture and an animated GIF of the same clip.

For native video controls, set the optional repository secret
`IOS_EVIDENCE_UPLOAD_TOKEN` to a user token with attachment upload access to
this repository. Only the trusted reporting step receives it. When the token
is absent or GitHub rejects an attachment, the reporter uses its workflow
token to commit the affected PNGs and animated GIFs to the
`ios-verification-media` branch. The verdict embeds images pinned to that
commit. This fallback requires the reporting job’s `contents: write` permission
and branch rules that allow it to create and update the media branch.

Published previews outlive the seven-day archive. Re-publishing the same
attempt reuses the previews in its existing verdict. If both publication paths
fail, the verdict retains the evidence archive link and the report logs the error.

## Development checks

```sh
npm ci --prefix tools/verify-ios --ignore-scripts
npm test --prefix tools/verify-ios
npm run lint
npm run type-check
actionlint -ignore 'unknown permission scope "copilot-requests"' -ignore 'unexpected key "cache-mode" for "job" section' .github/workflows/verify-ios.yml .github/workflows/verify-ios-report.yml
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

## Camera permission scenarios

Flows can set `launchApp.permissions.camera` to `allow` or `deny`, with an optional
`all` default. Mid-flow `setPermissions: { permissions: { camera: allow } }` (or
`deny`) targets only the app in the flow header. Alternate app IDs, other permission
keys, empty maps, and arbitrary values remain forbidden.

Maestro grants permissions on a default `launchApp`. A denial scenario must pass
an explicit camera denial and must not accidentally grant access with a later
default launch. Test Open settings, use its live Camera switch when available,
and resume with `stopApp: false` and explicit permissions. Runtime permission
changes may terminate the process on iOS; evidence must distinguish app recovery
from refresh in a surviving process. These checks remain blocking coverage.

## Build performance and reuse

The build job keeps a standalone Release app with OTA updates disabled. It runs
Expo prebuild, CocoaPods, and Xcode compilation as separate timed stages. Xcode
builds only `arm64` for the iOS simulator, skips signing and indexing, and emits
`-showBuildTimingSummary` in `build.log`. This archive is for the Apple Silicon
verification runner; it is not an Intel simulator or device build.

Native dependency downloads (CocoaPods and React Native) persist across runs.
`USE_CCACHE=1` enables React Native's compiler wrappers; a 500 MB ccache persists
between builds with matching dependency locks and toolchain. Swift compilation
and linking still run. Generated native projects and DerivedData are not cached.

Before installing app dependencies, the job checks an exact binary cache keyed by
the entire captured Git source tree, trusted build scripts/configuration, actual
Xcode build version, Node major, and the versioned Release/arm64 build policy.
There is no fallback key for binaries. An identical tree can reuse an archive;
source changes, including verifier files in the PR tree, conservatively invalidate
it. A hit must match its manifest and pass bundle ID, OTA-disabled, simulator
platform, and arm64 checks before compilation is skipped. Failed validation falls
back to a fresh build. Reused binaries are uploaded as this run's app artifact,
so verification and evidence/reporting do not depend on cache access.

`timings.json` and the Actions step summary show per-stage elapsed time, including
failed stages and cache validation. Build evidence includes separate dependency,
prebuild, pod, native compilation, and ccache-stat logs. Compare cold builds, warm
compiler-cache builds, and exact binary hits separately; cold builds still install
pods and compile native code. Real hosted-runner savings require a CI measurement.

## Simulator service and runtime preparation

The verification job uses the iOS 26.5 runtime preinstalled on `macos-26`.
On `xcode-27`, exporting and importing iOS 26.5 registered duplicate runtime
images, and CoreSimulator could lose the selected profile during cleanup. The
preinstalled runtime lets verification skip those runtime changes and retain
the iPhone 17 / iOS 26.5 target.

The runner requires an available runtime with the pinned identifier and OS
version. Apple can reissue a build for the same OS version, so the runner
records the actual build and CoreSimulator version. An unavailable runtime or
missing build metadata produces BLOCKED and records the error in
`runtime-preparation.json`. `runtime-list.log` captures the available runtimes.
Local verification can select another installed iOS runtime through the
existing `VERIFY_LOCAL_IOS_RUNTIME` override.

## Exploration reliability

Simulator provisioning records each command stage and duration in
`setup-commands.jsonl`, with attempt outcomes in `setup-attempts.json`. It stays
headless: it does not launch the Simulator GUI or run in-device language/locale
`defaults` writes. The pinned hosted image supplies English system UI, and flow
assertions still require the expected text. This avoids optional service calls
that stalled after boot in hosted evidence. It installs and launches the app
before warming Maestro's cold XCTest driver, so hierarchy reads target the app
instead of SpringBoard. Before app installation it tries to warm Photos and imports the fixture into the fresh library. The import remains required if the warm-up fails. Driver state and
internal debug logs are isolated under `setup-<attempt>-state/` in the evidence.
Fixture control initializes before device creation, with a 30-second startup
limit, so its first request does not compete with cold simulator services.
Fresh devices install directly without a redundant terminate/uninstall. First
app launch allows three minutes within the existing per-attempt deadline.
Receipt import allows five minutes for cold Photos services, within that
same deadline, rather than discarding a ready device after one minute.
CI setup failures also save bounded host process-name, memory, swap, and disk
snapshots under `setup-<attempt>-host-*.log`; local runs do not collect them. A provisioning timeout discards only that isolated device
and allows one fresh-device retry, with a fifteen-minute deadline per attempt.
The boot stage allows six minutes for hosted iOS data migration. Driver warm-up
has a separate five-minute command limit and a four-minute Maestro startup
allowance, with verbose logs. The attempt budget leaves room for both the
observed multi-minute cold migration and driver startup.
Permanent setup failures and app assertions are never retried. The setup budget
is separate from the 25-minute Copilot deadline. The first scenario reset reuses
the runner's fresh install only while no flow has touched the app; later resets
still reinstall it.
Every tool reports remaining time/calls. The adapter reserves two minutes for
final submission, stops starting UI work that could consume that reserve, and
keeps `submit_plan` available after exploration/call limits. Maestro MCP runs
without its optional viewer. Its first UI request allows five minutes for its own
XCTest startup; later requests allow three minutes. Both are capped by the shared
exploration deadline minus the finalization reserve. The prompt requests
a blocked checkpoint after the first complete scenario. Timeouts remain BLOCKED;
no partial exploration is promoted to PASS. Failure reports name recent tools
instead of suggesting that every timeout is an authentication/quota problem.

A ready plan must reference complete flows that succeeded as the first flow after
`reset_scenario` with the same fixture. Action/assertion changes invalidate that
evidence, and a later failed attempt invalidates prior success. The adapter and
runner independently check the trusted tool journal. Independent CLI replay is
still mandatory. Blocked plans can preserve failing scenarios for replay.

System Settings retains navigation state across reinstalls. Literal inline
`runFlow` branches may normalize that navigation using one `when.visible` or
`when.notVisible` selector. Only one branch level and navigation commands are
allowed. Files, env, JavaScript, nested branches, conditional assertions, and
conditional screenshots remain forbidden. Final assertions and screenshots stay
unconditional, and branch bodies count toward the 80-command limit.

For local diagnostics, `VERIFY_LOCAL_IOS_RUNTIME` can select an installed runtime
identifier. GitHub Actions rejects this override and retains pinned iOS 26.5.
Record local Xcode/runtime differences alongside the evidence; local runs do not
publish or replace the GitHub verification check.

Settings switches can expose the whole row as their accessibility frame. `tapOn`
may therefore use a bounded percentage `point` within an observed text/id target.
Standalone points, pixels, out-of-bounds percentages, and points on assertions are
forbidden. Camera-switch assertions must use that switch's ID and checked state;
labels "0"/"1" alone may match a different permission. Direct permission injection
requires a stop/relaunch check; use the native switch to assess foreground refresh.

## Required camera regressions

Changes to `app/camera.tsx` or `components/camera-session.tsx` select two trusted,
deterministic regressions before Copilot exploration: both zoom bounds (including
twenty zoom-in steps and the disabled upper-bound control), Reset and foreground
lifecycle; and native Settings permission recovery with checked-state assertions
and an element-anchored switch tap. The first flow reuses the untouched initial installation; the second runs after a fresh reinstall through
Maestro CLI and requires successful JUnit evidence. Each has a six-minute bound
including reset, driver startup, and the complete flow. Hosted startup alone has
consumed almost two minutes before the first assertion. The flows contain no
scripts or optional assertions, and a timeout remains BLOCKED even with JUnit.

Results and logs are stored in `regressions.json` and `regressions/<id>/`. The
agent reads summaries in get_context and exact scenarios with get_regression,
reviews the diff/source, and inspects the live UI. It reuses verified coverage
instead of spending its exploration budget rebuilding these tests. A ready plan
must include both exact required scenarios; a failed, missing, or altered required
regression cannot be waived. Independent fresh-reset replay still runs after the
plan is submitted. An extra scenario remains available for other changed behavior.

These are stable application UI contracts, not PR-number-specific exceptions.
Intentional changes to those contracts need a reviewed update to the trusted
regression; assertions are never removed merely to obtain PASS. Other PRs retain
the existing exploration flow. A verifier-only change to these recipes does not
require merging tooling into the application PR: a fresh /verify captures current
trusted main and can reuse the exact already-built application binary.

## Cache access on comment-triggered builds

GitHub defaults `issue_comment` runs to read-only cache access. The authorized
build job explicitly sets `cache-mode: write` so npm/native/compiler and validated
binary caches can actually be saved. This is separate from `GITHUB_TOKEN`
permissions, which remain `contents: read` for that job. Admission still requires
a repository writer and a PR head owned by this repository; forks are rejected.
Verification and reporting do not gain cache-write access. Do not restore these
build caches into a job with secrets or repository-write privileges.

GitHub documents this behavior under [cache access for low-trust workflow
triggers](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching#cache-access-for-low-trust-workflow-triggers).
A successful cache action alone is insufficient proof of a save: inspect the
save logs or repository cache inventory for a persisted key. A read-only save
failure is only a warning and does not fail the build.

Actionlint 1.7.12 also predates GitHub's documented job-level `cache-mode` key;
the development command narrowly ignores that key's schema diagnostic while
retaining all other workflow validation. Workflow tests assert that only the
writer-authorized build job receives cache-write access.
