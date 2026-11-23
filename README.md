# Settle Down

Settle Down is a mobile app for splitting receipts. You photograph a receipt, a backend reads its line items, you say who had what, and the app posts the split as a transaction to a [Settle Up](https://settleup.io) group.

It's built with Expo (SDK 58), React Native and Expo Router, and runs on iOS and Android.

## How it works

```
Camera / Library  →  Loading (upload + OCR)  →  Receipt details  →  Settle Up
   app/camera.tsx       app/loading.tsx         app/receipt-details.tsx
```

1. **Capture** (`app/index.tsx`, `app/camera.tsx`): take a photo of the receipt or pick one from your photo library.
2. **Read** (`app/loading.tsx`): the photo is uploaded to the backend, which extracts the shop name, date, items, tax and total. The upload makes up to 3 attempts with exponential backoff.
3. **Assign** (`app/receipt-details.tsx`):
   - choose a Settle Up group and who paid
   - assign an item to one member, mark it **Shared** across the group, or use **Split…** to divide it among selected members equally or by quantity
   - correct item costs, the tax %, or the receipt date if needed
   - review line prices, item coupons, checkout discounts and points redeemed. Tap a deduction to correct it or confirm eligible products against the photo. The shopping total includes checkout discounts and any added tax. Redeemed points reduce the payment shared by the group. Then use **Show my share** to see and share the breakdown after the assignments and totals balance
4. **Sync**: the split is sent to Settle Up as a transaction.

### Receipt inbox and offline behavior

Open **Inbox** from the camera to pick up an unfinished receipt. Camera captures and library selections are copied to app storage before scanning. If you are offline or the upload fails, open the saved photo from the inbox when you are online.

Scanned drafts save edits, the selected group, payer, and item assignments on this device as you work. Tap **Save for later** to return to the inbox, or reopen the draft after leaving the app. A confirmed Settle Up submission or an explicit **Discard** removes the draft and its inbox photo.

### Receipt reminders in Expo Go

Settle Down schedules local notifications in the SDK 58 Expo Go app. Allow notifications for Expo Go when you first leave a receipt for later. The three-hour reminder keeps its original deadline. Receipts due the next morning share a 9 AM reminder. If you change time zones while Expo Go is closed, the pending morning alert can still fire on the previous zone’s schedule. Reopening Settle Down before delivery updates it to the current zone.

On iOS, tapping a reminder while Expo Go is in the background returns to the saved receipt. If Expo Go was fully closed, the alert still appears. Tapping it can open Expo Go Home, where you can select Settle Down from **Recently Opened**.

## Tech stack

- **Expo SDK 58**, React Native 0.88, React 19, TypeScript
- **Expo Router**: file-based routing in `app/`, with typed routes and the React Compiler enabled
- **expo-camera** and **expo-image-picker** for capturing and selecting receipt photos
- **@react-native-community/netinfo** to detect when the device is offline
- **expo-haptics** and React Native's built-in `Animated` API for feedback and motion (shared helpers are in `components/motion.tsx`)
- **EAS Build / EAS Update** for distribution

## Project structure

```
app/
  _layout.tsx          Root stack (no headers, slide transitions)
  index.tsx            Home: hosts the camera, plus an optional debug "Skip to Receipt" button
  camera.tsx           Camera view, shutter, library picker, permission prompt
  inbox.tsx            Reopen and discard saved receipt drafts
  loading.tsx          Connectivity check, upload with retries, offline fallbacks
  receipt-details.tsx  Item editing, member assignment, Settle Up sync
components/
  motion.tsx           Entrance / PressableScale animation primitives
utils/
  theme.ts             Colors, type scale, shadows, per-user color mapping
```

## Backend API

The app needs a backend. It reads the backend's base URL from `EXPO_PUBLIC_API_BASE_URL` and calls these endpoints:

| Method | Endpoint                              | Purpose                                                                   |
| ------ | ------------------------------------- | ------------------------------------------------------------------------- |
| `POST` | `/api/v1/receipts/receipt-items/`     | Upload a receipt image (multipart `file`) and get back the parsed receipt |
| `GET`  | `/api/v1/settle-up/groups/`           | List Settle Up groups                                                     |
| `GET`  | `/api/v1/settle-up/users/?group_id=…` | List the members of a group                                               |
| `POST` | `/api/v1/settle-up/transactions/`     | Create the split transaction                                              |

If `EXPO_PUBLIC_AUTH_TOKEN` is set, every request includes it as `Authorization: Bearer <token>`. Every request also sends `ngrok-skip-browser-warning`, so the backend can be exposed through an ngrok tunnel.

## Getting started

### Prerequisites

- Node (the version is in `.nvmrc`; run `nvm use`)
- A running instance of the backend
- For device builds: an [Expo](https://expo.dev) account with access to the EAS project

### Setup

```bash
nvm use
npm ci
cp .env.sample .env
```

Then edit `.env`:

| Variable                             | Description                                                                                                                            |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| `EXPO_PUBLIC_API_BASE_URL`           | The backend's base URL, e.g. `http://192.168.0.242:8000` or an ngrok URL                                                               |
| `EXPO_PUBLIC_AUTH_TOKEN`             | Optional public client token. Anyone with the app can read it. Keep private service credentials on the backend.                        |
| `EXPO_PUBLIC_SHOW_DEBUG_SKIP_BUTTON` | `true` shows a "Skip to Receipt" button that opens the details screen with mock data, so you can work on that screen without a backend |

> `EXPO_PUBLIC_*` values are inlined when the app is bundled. `.env` is gitignored, so EAS builds run in the cloud don't see it. Set these variables as EAS environment variables for the `preview` and `production` environments.

### Run

```bash
npm start          # Expo dev server (scan the QR code with Expo Go or a dev build)
npm run ios        # Build and run on the iOS Simulator
npm run android    # Build and run on an Android emulator or device
```

Your phone must be able to reach `EXPO_PUBLIC_API_BASE_URL`. A LAN IP works only on the same Wi-Fi network; otherwise use a tunnel such as ngrok.

### Checks

```sh
npm ci --prefix tools/verify-ios --ignore-scripts --omit=dev
npm run check       # formatting, typed lint, types, tests, unused code
npm run format      # apply formatting locally
```

PRs automatically run the quality gate and applicable native build/smoke checks.
See [CI checks, local commands, coverage, and activation](docs/ci.md).

## PR verification

Repository writers can comment `/verify` on an open, same-repository PR targeting `main`. App and dependency changes require this check. The applicability workflow automatically passes it for documentation, workflow, and verifier-only changes. Copilot explores the changed iOS behavior, saves
Maestro tests, and CI replays them against a synthetic local backend. The PR gets
a separate final verdict comment identifying working, failing, or untestable
behavior, with the captured commit and links to video, screenshots, test flows, and logs.
Only PR changes are covered. See [setup, limits, and troubleshooting](tools/verify-ios/README.md).

## Builds and updates

EAS profiles are defined in `eas.json`:

| Profile       | Distribution                          | Channel       |
| ------------- | ------------------------------------- | ------------- |
| `development` | internal (dev client)                 | `development` |
| `preview`     | internal                              | `preview`     |
| `production`  | store (auto-incremented build number) | `production`  |

```bash
npm run build:preview        # Internal build you can install on test devices
npm run build:production     # Store build

npm run update:preview       # Push an over-the-air (OTA) JS update to the preview channel
npm run update:production    # Push an OTA JS update to the production channel
```

`runtimeVersion` follows `appVersion`, so OTA updates only reach builds with the same app version (`app.json` → `expo.version`).

`app.config.ts` points builds and updates to [@org-ryan/settle-down](https://expo.dev/accounts/org-ryan/projects/settle-down). The existing `:org` npm commands are aliases for the commands above.

The repository owner publishes previews by manually running **Publish Expo Go previews** on `main`. You can start the workflow while CI is running. It checks every 30 seconds until all push workflows for the selected `main` commit pass, including `Quality`, `Native smoke` (iOS and Android), and `Security`. Publishing proceeds automatically once CI passes. A completed failure or cancellation stops the release immediately. Each gate waits up to 90 minutes for queued, running, or missing checks and reports any blockers with run links when available.

For a new preview, the workflow publishes iOS and Android to the org's `preview` channel using its EAS `preview` environment. It creates a GitHub prerelease tagged `v<expo.version>-<commit SHA>` and attaches `expo-groups.json` with the `org-ryan` update group ID.

**Publish or restore a preview**

1. Open **Actions → Publish Expo Go previews → Run workflow** as the GitHub repository owner. Select the `main` branch.
2. Leave **release_tag** empty to publish the current `main`. To restore an older preview, paste its full tag from [GitHub Releases](https://github.com/RyanAquino/settle-down/releases). A restore checks CI on the current tip of `main`, then republishes the saved `org-ryan` group to `preview`. This also works for older manifests that list both projects.
3. Click **Run workflow**. A restored update serves clients on the release's original runtime.

The GitHub repository owner can publish and retry releases. If recording the GitHub prerelease fails after Expo accepts the update, choose **Re-run failed jobs**. The release job reuses the saved group.

Set the repository Actions secret `EXPO_TOKEN` to an Expo access token with publish access to the org project. [Create an Expo access token](https://expo.dev/settings/access-tokens).

Invite Expo Go testers to `org-ryan` and share the org preview QR code, including with testers who previously opened a personal-project link. Standalone builds embed their project's update URL. To receive org updates, users of an older personal build need a build generated with the org configuration. iOS internal distribution requires a paid Apple Developer account to register devices.
