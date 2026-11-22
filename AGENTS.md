# Settle Down

This repository contains the Expo Router mobile client for iOS and Android. A separate backend reads receipt photos and handles Settle Up API requests. The client lets users correct the receipt, assign items to group members, and submit the split.

## Starting a feature or fix

Start every feature and bug fix by creating a dedicated Git worktree for it with `git worktree add`. Make changes, run checks, and commit from that worktree.

Assign pull requests to `RyanAquino` when opening them.

Include the fixtures, accessible controls, and assertions needed for CI `/verify` to exercise each simulator-observable change when the PR opens. The verifier runs trusted tooling from the default branch against the PR’s app build. Use capabilities already available there, or land a prerequisite tooling PR first. Document how to reach the changed behavior and what the verifier should observe.

## Local development

Use the Node version in `.nvmrc`. Install both npm packages from the repository root to run the full set of local checks.

```sh
nvm use
npm ci
npm ci --prefix tools/verify-ios --ignore-scripts --omit=dev
```

For a fresh checkout, copy `.env.sample` to `.env` and set `EXPO_PUBLIC_API_BASE_URL` to a backend reachable from the device. Expo embeds `EXPO_PUBLIC_*` values in the app bundle. Set `EXPO_PUBLIC_SHOW_DEBUG_SKIP_BUTTON=true` to open receipt details with sample items and skip the upload.

Run `npm start` for the Expo dev server, or `npm run ios` / `npm run android` for a native build. The native project directories are generated. Put persistent Expo configuration in `app.json` and keep EAS project selection in `app.config.ts`.

## Receipt flow

- `app/index.tsx` mounts the camera while the home screen is focused. Preserve camera release on navigation. Capture and library selection pass a `photoUri` to `app/loading.tsx`. Library picks also set `fromLibrary`.
- The upload screen treats only an explicit `isConnected === false` as offline. Save camera captures and library imports in the Receipt Inbox before upload. When offline or after upload retries are exhausted, direct users to the saved draft.
- Append an `expo-file-system` File to the multipart field `file` and let fetch set the boundary. On success the loading screen replaces itself with `/receipt-details`, passing the serialized response in the `data` route param.
- Keep API schemas, receipt parsing, totals, split payloads, and currency formatting in `utils/receipt.ts`. Each item's `cost` already covers its full quantity. Use `item_order` as the stable key for rendering, cost edits, and member selections. Format amounts using the selected group's currency and display plain numbers until a currency is available.

## UI and tests

Use `@/` for imports from the repository root. Reuse design tokens and member colors from `utils/theme.ts` and the React Native Animated primitives in `components/motion.tsx`. Keep Jest tests in `tests/` so Expo Router only discovers screens and layouts in `app/`.

Run a focused suite while editing, for example `npm test -- --runInBand tests/receipt.test.ts` for receipt calculations. Run `npm run check` for formatting, lint, TypeScript, Jest with coverage, iOS verification-tool tests, and unused-code checks. The tooling tests start a local fixture server.

See [CI checks](docs/ci.md) for native smoke tests and production bundle checks, and the [iOS verification guide](tools/verify-ios/README.md) for PR-specific simulator testing.
