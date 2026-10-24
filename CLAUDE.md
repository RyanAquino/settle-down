# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Settle Down is an Expo SDK 58 / React Native app with Expo Router. It photographs a receipt, uploads it to a separate backend that parses the line items, lets the user assign each item to members of a Settle Up group (or mark it "shared"), then posts the split as a Settle Up transaction. The backend lives in another repo; this one is only the mobile client.

## Commands

```bash
npm start              # expo start (Expo Go)
npm run ios            # expo run:ios (native build; /ios is generated and gitignored)
npm run android
npm run lint           # expo lint (eslint-config-expo, flat config)
npm run type-check     # tsc --noEmit
npm run build:preview  # EAS internal-distribution build
npm run update:preview # EAS OTA update to the preview channel (also :production variants)
```

There is no test suite. Verify changes with `npm run lint` and `npm run type-check`. The `reset-project` script points to a file that doesn't exist, so don't use it.

## Architecture

The app is a single stack of four routes in `app/`, with no tabs or global state. Data moves between screens only through route params, using `router.push` or `router.replace` with stringified values:

- `index.tsx` mounts `camera.tsx` as a component (not a route) and only while the screen is focused, so the camera is released when you navigate away. `camera.tsx` pushes `/loading` with `photoUri` and, for library picks, `fromLibrary`.
- `loading.tsx` checks connectivity with NetInfo. It treats only `isConnected === false` as offline; `null` counts as online on purpose. It then uploads with 3 attempts and exponential backoff. On success it `replace`s to `/receipt-details` with `data: JSON.stringify(apiResponse)`. On failure or offline it saves the camera photo to the media library and `replace`s back to `/` with a `message` or `error` param, and `camera.tsx` shows that param as an Alert.
- `receipt-details.tsx` is the large screen (~1100 lines). It parses `params.data`, or uses inline mock data when `useMockData=true`. It fetches groups, then the selected group's users, lets the user edit costs, tax and date, and POSTs `/api/v1/settle-up/transactions/`. It has its own `retryApiCall` helper.

API calls are made with plain `fetch` in each screen; there is no shared API client. Every request reads `EXPO_PUBLIC_API_BASE_URL` and the optional `EXPO_PUBLIC_AUTH_TOKEN` (sent as a Bearer token) and sends an `ngrok-skip-browser-warning` header.

### Non-obvious invariants

- **Item cost is the line total.** `cost` from the API already includes quantity, so never multiply it by `quantity` when computing subtotals or splits.
- **Per-item state is keyed by `item_order`, not array index.** This covers `userSelections`, `costInputs` and React keys. Items are sorted by `item_order` once on init.
- **Amounts display in the selected group's currency.** `GET /groups/` returns each group's ISO `currency`, and `formatMoney` in `receipt-details.tsx` formats with `Intl` `symbol` style (`¥`, `NT$`, `HK$`). Whole amounts drop `.00`. Until a group is selected, amounts are plain numbers with no symbol. Don't hardcode a currency symbol.
- **Multipart upload:** SDK 56+ replaced the global `fetch` with `expo/fetch`. Its FormData doesn't accept React Native's `{ uri, type, name }` objects, so append `new File(uri)` from `expo-file-system`. Never set `Content-Type` manually on multipart requests, because fetch has to add the boundary itself.
- **`EXPO_PUBLIC_*` variables are inlined at bundle time.** `.env` is gitignored, so EAS cloud builds get these values from EAS environment variables. `loading.tsx` throws on purpose if the base URL is undefined.
- **Debug mock data:** setting `EXPO_PUBLIC_SHOW_DEBUG_SKIP_BUTTON=true` adds a "Skip to Receipt" button that opens the details screen with mock data, so you can work on that screen without a backend.

### UI conventions

- Design tokens (`theme`, `shadow`, `type`, `motion`) and the per-user color helpers are in `utils/theme.ts`. Use `buildUserColorMap` (colors assigned by index, so they're always distinct) for a known member list.
- Use the built-in RN `Animated` API with `useNativeDriver`. Reanimated is installed but no Babel plugin or worklets are configured, so don't write Reanimated code. Reuse `Entrance` (staggered fade-and-lift) and `PressableScale` (press spring plus haptics) from `components/motion.tsx`.
- Animated values are created with `useState(() => new Animated.Value(...))` rather than `useRef`, because the React Compiler is enabled (`experiments.reactCompiler`) and the lint rules for it apply. Existing `eslint-disable` comments for `react-hooks/*` each have a justification comment next to them; follow that pattern.
- Imports use the `@/` alias for the repo root.

## Distribution notes

- `runtimeVersion` uses the `appVersion` policy, so OTA updates only reach builds with the same `expo.version` in `app.json`.
- Expo Go QR links from `eas update` return a 403 for people who aren't members of the Expo project. Share internal-distribution EAS builds instead; iOS builds need a paid Apple Developer account.
