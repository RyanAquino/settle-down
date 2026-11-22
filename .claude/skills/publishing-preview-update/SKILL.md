---
name: publishing-preview-update
description: Use when publishing, deploying, pushing or updating the settle-down app on the EAS Update "preview" channel or Expo Go, rolling back a bad preview update, or when a tester cannot open the preview (403, incompatible SDK).
---

# Publishing a preview update

## Overview

Preview updates deliver JavaScript and assets on the `preview` channel of `@org-ryan/settle-down`. The channel serves the `preview` branch. The runtime version comes from `expo.version` in `app.json` (the `appVersion` policy). The EAS project ID and update URL come from `app.config.ts`.

## Stop first if any of these apply

| Situation | Do this instead of publishing straight away |
|---|---|
| A native module was added or changed that Expo Go doesn't ship (proxy: missing from `node_modules/expo/bundledNativeModules.json`) | Don't publish; Expo Go would crash at launch. It needs a dev build: `npx expo run:ios` on the Simulator. A physical iPhone via EAS needs a paid Apple Developer account, which this project doesn't have. |
| Expo SDK bump | Confirm on the App Store that Expo Go supports the new SDK. Each Expo Go supports only one SDK, and the store lags new releases by weeks. Warn that teammates on the old Expo Go lose access. Smoke-test first with `npm start`, then press `i`. |
| Native change, and `eas build:list` shows builds at the current runtime | Bump `expo.version` in `app.json` first, so those builds don't receive an incompatible bundle. |
| A tester gets a 403 | Republishing won't help; see Access. |

## Publish

```bash
gh workflow run publish-preview.yml --ref main
```

Run the workflow as the GitHub repository owner. It waits for main CI, publishes both platforms using the org's EAS `preview` environment, and attaches the group ID to the tagged prerelease. The preview environment points at the production Railway backend.

## Verify

```bash
eas update:list --branch preview --limit 2 --non-interactive
```

For a new release, match the latest group's ID to the `org-ryan` entry in the GitHub release's `expo-groups.json`. Check that the update lists iOS, Android, and the expected runtime.

## What to tell the user

- Open the org update from the EAS dashboard, then fully reopen the project in Expo Go.
- Expo Go must be signed in as the project owner or an org member, and the App Store Expo Go must support the project's SDK.
- Anything synced from preview goes to the production backend.

## Roll back

```bash
gh workflow run publish-preview.yml --ref main -f release_tag="<full GitHub preview release tag>"
```

The workflow waits for CI on current `main` and republishes the release's saved org group to `preview` on its original runtime. Older release manifests with a second project entry also work.

## Access (403 in Expo Go)

Since 2026-05-12, Expo Go only opens EAS Updates for projects that the signed-in account owns, or that belong to an org it's a member of. Making the project public doesn't help, and neither does republishing. The options:
- Invite the tester to `org-ryan` (Viewer is enough) and share the `@org-ryan/settle-down` update.
- Run `npx expo start --tunnel` for a live session; your machine must stay on.
- Build an Android internal APK with `eas build --profile preview --platform android`.
- iOS standalone builds need a paid Apple Developer account.

## Common mistakes

- Skipping `npm ci` after a pull, so the bundle is built from stale `node_modules`.
- Leaving out `--non-interactive`: prompts hang in agent shells.
- Bumping `expo.version` for a JS-only change.
- Leaving out `--environment preview`: the bundle gets the LAN URL from `.env`.
