---
name: publishing-preview-update
description: Use when publishing, deploying, pushing or updating the settle-down app on the EAS Update "preview" channel or Expo Go, rolling back a bad preview update, or when a tester cannot open the preview (403, incompatible SDK).
---

# Publishing a preview update

## Overview

"Preview" means an EAS Update: an over-the-air JS and assets bundle published to channel `preview`, which serves branch `preview`. It never ships native code. The runtime version comes from `app.json` `expo.version` (the `appVersion` policy). Today the only consumer is Expo Go: `eas build:list` shows no installed builds at the current runtime.

The app lives in two EAS projects that share nothing: `@ryan.aquino/settle-down` (the default) and `@org-ryan/settle-down`, the copy that org members open.
`app.config.ts` picks the project from `EAS_PROJECT_OWNER`, and the `:org` scripts set it to `org-ryan`.
Publish every update to both projects so they serve the same bundle.

## Stop first if any of these apply

| Situation | Do this instead of publishing straight away |
|---|---|
| A native module was added or changed that Expo Go doesn't ship (proxy: missing from `node_modules/expo/bundledNativeModules.json`) | Don't publish; Expo Go would crash at launch. It needs a dev build: `npx expo run:ios` on the Simulator. A physical iPhone via EAS needs a paid Apple Developer account, which this project doesn't have. |
| Expo SDK bump | Confirm on the App Store that Expo Go supports the new SDK. Each Expo Go supports only one SDK, and the store lags new releases by weeks. Warn that teammates on the old Expo Go lose access. Smoke-test first with `npm start`, then press `i`. |
| Native change, and `eas build:list` shows builds at the current runtime | Bump `expo.version` in `app.json` first, so those builds don't receive an incompatible bundle. |
| A tester gets a 403 | Republishing won't help; see Access. |

## Publish

```bash
git fetch origin && git checkout main && git pull --ff-only
git status --porcelain        # must print nothing: EAS records the commit
npm ci                        # exact lockfile; .npmrc supplies legacy-peer-deps
npm run type-check && npm run lint && npx expo-doctor
npm run update:preview -- --message "main $(git rev-parse --short HEAD): <summary>" --non-interactive
npm run update:preview:org -- --message "main $(git rev-parse --short HEAD): <summary>" --non-interactive
```

`update:preview` runs `eas update --channel preview --environment preview`. `--environment preview` makes eas-cli set `EXPO_NO_DOTENV=1`, so the local `.env` (LAN backend) is ignored and the `EXPO_PUBLIC_*` values come from the EAS preview environment. That environment points at the **production** Railway backend. If you call `eas update` directly, keep both flags, and prefix it with `EAS_PROJECT_OWNER=org-ryan` for the org project.
Each project has its own copy of the preview environment variables; if you change one, change the other (`EAS_PROJECT_OWNER=org-ryan eas env:update ...`).

## Verify

```bash
eas update:list --branch preview --limit 2 --non-interactive   # new group on top, expected runtime
EAS_PROJECT_OWNER=org-ryan eas update:list --branch preview --limit 2 --non-interactive
for p in ios android; do f=$(ls dist/_expo/static/js/$p/entry-*.hbc)
  echo "$p: $(strings "$f" | grep -oE 'https://[a-z0-9.-]+railway\.app' | sort -u) lan=$(grep -c -a '192\.168\.' "$f")"; done
```

You should see the Railway host and `lan=0`. Hermes bytecode packs strings together, so use unanchored `grep -a`, not `^...$`.

## What to tell the user

- Open the update from the EAS dashboard link that `eas update` prints, then fully reopen the project in Expo Go.
- Expo Go must be signed in as the project owner or an org member, and the App Store Expo Go must support the project's SDK.
- Anything synced from preview goes to the production backend.

## Roll back

```bash
eas update:list --branch preview --limit 5 --non-interactive
eas update:rollback <BROKEN_GROUP_ID> -m "Roll back <BROKEN_GROUP_ID>" --non-interactive
```

Group IDs differ between the two projects, so roll back each one separately, running the same commands with `EAS_PROJECT_OWNER=org-ryan` for the org project.

The broken group has to be the latest one on its branch and runtime; rollback then republishes the group before it. If no earlier group exists at that runtime, rollback publishes a roll-back-to-embedded, which Expo Go can't use (it has no embedded bundle). In that case fix forward. To restore a specific older group with the same runtime, use `eas update:republish --group <GOOD_ID> --non-interactive`. Never roll back by running a fresh `eas update` from the working tree.

## Access (403 in Expo Go)

Since 2026-05-12, Expo Go only opens EAS Updates for projects that the signed-in account owns, or that belong to an org it's a member of. Making the project public doesn't help, and neither does republishing. The options:
- Invite the tester to the `org-ryan` org (Viewer is enough) and have them open the `@org-ryan/settle-down` update, not the personal one.
- Run `npx expo start --tunnel` for a live session; your machine must stay on.
- Build an Android internal APK with `eas build --profile preview --platform android`.
- iOS standalone builds need a paid Apple Developer account.

## Common mistakes

- Skipping `npm ci` after a pull, so the bundle is built from stale `node_modules`.
- Leaving out `--non-interactive`: prompts hang in agent shells.
- Bumping `expo.version` for a JS-only change.
- Leaving out `--environment preview`: the bundle gets the LAN URL from `.env`.
- Publishing to only one of the two projects, so personal and org testers see different builds.
