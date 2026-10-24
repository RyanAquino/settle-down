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
   - assign each item to a group member or mark it **Shared**
   - correct item costs, the tax %, or the receipt date if needed
4. **Sync**: the split is sent to Settle Up as a transaction.

### Offline behavior

- **Camera photos taken offline** are saved to your photo library, so you can process them later.
- **Library photos picked offline** are rejected with a prompt to try again once you're online.
- **Uploads that fail** after all retries also fall back to saving camera photos to your library.

## Tech stack

- **Expo SDK 58**, React Native 0.88, React 19, TypeScript
- **Expo Router**: file-based routing in `app/`, with typed routes and the React Compiler enabled
- **expo-camera** and **expo-image-picker** for capturing receipts; **expo-media-library** for saving photos offline
- **@react-native-community/netinfo** to detect when the device is offline
- **expo-haptics** and React Native's built-in `Animated` API for feedback and motion (shared helpers are in `components/motion.tsx`)
- **EAS Build / EAS Update** for distribution

## Project structure

```
app/
  _layout.tsx          Root stack (no headers, slide transitions)
  index.tsx            Home: hosts the camera, plus an optional debug "Skip to Receipt" button
  camera.tsx           Camera view, shutter, library picker, permission prompt
  loading.tsx          Connectivity check, upload with retries, offline fallbacks
  receipt-details.tsx  Item editing, member assignment, Settle Up sync
components/
  motion.tsx           Entrance / PressableScale animation primitives
utils/
  theme.ts             Colors, type scale, shadows, per-user color mapping
```

## Backend API

The app needs a backend. It reads the backend's base URL from `EXPO_PUBLIC_API_BASE_URL` and calls these endpoints:

| Method | Endpoint | Purpose |
| ------ | -------- | ------- |
| `POST` | `/api/v1/receipts/receipt-items/` | Upload a receipt image (multipart `file`) and get back the parsed receipt |
| `GET`  | `/api/v1/settle-up/groups/` | List Settle Up groups |
| `GET`  | `/api/v1/settle-up/users/?group_id=…` | List the members of a group |
| `POST` | `/api/v1/settle-up/transactions/` | Create the split transaction |

If `EXPO_PUBLIC_AUTH_TOKEN` is set, every request includes it as `Authorization: Bearer <token>`. Every request also sends `ngrok-skip-browser-warning`, so the backend can be exposed through an ngrok tunnel.

## Getting started

### Prerequisites

- Node (the version is in `.nvmrc`; run `nvm use`)
- A running instance of the backend
- For device builds: an [Expo](https://expo.dev) account with access to the EAS project

### Setup

```bash
nvm use
npm install
cp .env.sample .env
```

Then edit `.env`:

| Variable | Description |
| -------- | ----------- |
| `EXPO_PUBLIC_API_BASE_URL` | The backend's base URL, e.g. `http://192.168.0.242:8000` or an ngrok URL |
| `EXPO_PUBLIC_AUTH_TOKEN` | Optional bearer token for the backend |
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

```bash
npm run lint
npm run type-check
```

## Builds and updates

EAS profiles are defined in `eas.json`:

| Profile | Distribution | Channel |
| ------- | ------------ | ------- |
| `development` | internal (dev client) | `development` |
| `preview` | internal | `preview` |
| `production` | store (auto-incremented build number) | `production` |

```bash
npm run build:preview        # Internal build you can install on test devices
npm run build:production     # Store build

npm run update:preview       # Push an over-the-air (OTA) JS update to the preview channel
npm run update:production    # Push an OTA JS update to the production channel
```

`runtimeVersion` follows `appVersion`, so OTA updates only reach builds with the same app version (`app.json` → `expo.version`).

**Sharing with testers:** Expo Go QR links from `eas update` don't open for people who aren't members of the Expo project. Use an internal-distribution build (`build:preview`) instead. iOS internal builds require a paid Apple Developer account to register devices.
