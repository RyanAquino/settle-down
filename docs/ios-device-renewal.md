# Install and renew Settle Down on iPhones with Xcode

This installs Settle Down as its own app on a physical iPhone. Expo Prebuild generates the `ios/` project. Xcode signs and builds it. The Release build includes the JavaScript bundle so you can open it away from the Mac. [Expo local build guide](https://docs.expo.dev/guides/local-app-development/)

With a free Apple Personal Team, a provisioning profile expires seven days after Apple issues it. One Mac can renew the app independently on two paired iPhones. [Apple’s Personal Team limits](https://developer.apple.com/help/account/basics/about-your-developer-account/)

## 1. Prepare the Mac and pair the phones

Install Xcode and CocoaPods. Sign in to your Apple account in Xcode and note the 10-character ID for your Personal Team. For an existing Settle Down installation, use the same team shown under **Development Team** in the app target’s Release build settings. The helper passes that team and automatic signing to Xcode for the bundle identifier `com.ryan.aquino.settledown`.

1. Unlock each phone and connect it to the Mac by USB for initial pairing. Accept **Trust This Computer** and enable **Developer Mode** if prompted. In Xcode, open **Device Hub** from **Xcode → Open Developer Tool**, select the phone, and resolve any pairing prompts. A paired phone can subsequently connect over the same Wi-Fi. [Apple’s device pairing guide](https://developer.apple.com/documentation/xcode/managing-your-simulated-and-physical-devices-in-device-hub)
2. Run `xcrun devicectl list devices` and copy each physical iPhone’s hardware **UDID**. The examples use `ryan` for the iPhone 16 Pro and `maiphone` for the iPhone 13 mini. You can configure both while one is away.

## 2. Install or upgrade the renewal helper

Run the setup from the repository root in Terminal. The helper saves the URL of `origin` and copies the local Expo production environment files that exist (`.env`, `.env.local`, `.env.production`, and `.env.production.local`) into `~/Library/Application Support/SettleDownRenewal`. Set `EXPO_PUBLIC_API_BASE_URL` to a backend reachable by both phones. On a fresh checkout, use `.env.sample` as a starting point. The scheduled job uses the saved configuration and can run with the development checkout on the Desktop.

Only on **first setup**, run the following after replacing the UDID placeholders. Omit the second device line for a single phone. **For an upgrade**, keep the existing settings and go straight to the install command below.

```sh
nvm use
kit="$HOME/Library/Application Support/SettleDownRenewal"
mkdir -p "$kit"
(umask 077 && cat > "$kit/settings.ini" <<EOF
[build]
node = $(command -v node)

[devices]
ryan = REPLACE_WITH_IPHONE_16_PRO_UDID
maiphone = REPLACE_WITH_IPHONE_13_MINI_UDID
EOF
)
```

Install the [renewal helper](../tools/ios-renewal/renew.py) with your actual team ID. Run this command again after updating the helper, changing the remote or editing the production environment files. An existing LaunchAgent picks up the installed script on its next run. Each phone retains its install record.

```sh
/usr/bin/python3 tools/ios-renewal/renew.py --install REPLACE_WITH_TEAM_ID
```

### What each device push builds

After a phone is due and reachable, the helper fetches the `main` branch from the saved origin into its own Git repository and creates a detached worktree at the fetched commit under `~/Library/Caches/SettleDownRenewal/worktree`. It copies the saved environment files there, runs `npm ci --include=dev`, and runs `NODE_ENV=production npx expo prebuild --platform ios --clean`. Xcode then builds the generated workspace in Release for that phone, with `CODE_SIGN_STYLE=Automatic` and the saved `DEVELOPMENT_TEAM`.

Before installing, the helper checks the app’s bundle ID and verifies that the embedded profile matches the team, covers the destination UDID, and has a sufficiently late expiration. Each successful install records the Git commit and expiration. The helper removes the worktree after the attempt. Each phone gets its own fetch and prebuild, even when both are due in the same hourly check. A fetch or build failure leaves the install pending for the next check.

## 3. Install and trust the app on each iPhone

Unlock the first phone and run its command. Wait for `Installed Settle Down on ryan`, then open the app. Repeat the second command when the mini shows as available. If a phone is unavailable over Wi-Fi, reconnect it by USB and check Device Hub.

```sh
kit="$HOME/Library/Application Support/SettleDownRenewal"
/usr/bin/python3 "$kit/renew.py" --device ryan
/usr/bin/python3 "$kit/renew.py" --device maiphone
```

If iOS displays **Untrusted Developer**, open **Settings → General → VPN & Device Management**, select your developer entry, and follow the trust prompts on that iPhone. Each phone approves its developer certificate locally. The Mac automates the reinstall. iOS requires the person using the phone to grant trust. [Apple’s Personal Team device instructions](https://github.com/apple/sample-food-truck/blob/main/README.md)

A replacement signing certificate can trigger a new prompt even with the same team. The weekly provisioning profile can renew while Xcode continues using the same trusted certificate. Leave the app installed so the helper can update it in place.

## 4. Enable hourly checks

You can start the schedule after the first phone succeeds. The other phone gets its first install when it becomes reachable. Run this once in your logged-in macOS account:

```sh
kit="$HOME/Library/Application Support/SettleDownRenewal"
label=com.ryan.settledown.renew
agent="$HOME/Library/LaunchAgents/$label.plist"
mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"

cat > "$kit/$label.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>$label</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/bin/python3</string>
        <string>$kit/renew.py</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>StartCalendarInterval</key>
    <dict>
        <key>Minute</key>
        <integer>15</integer>
    </dict>
    <key>StandardOutPath</key>
    <string>$HOME/Library/Logs/SettleDownRenewal.log</string>
    <key>StandardErrorPath</key>
    <string>$HOME/Library/Logs/SettleDownRenewal.log</string>
</dict>
</plist>
PLIST

plutil -lint "$kit/$label.plist" &&
  cp "$kit/$label.plist" "$agent" &&
  launchctl bootstrap "gui/$(id -u)" "$agent"
```

The agent checks at login and **15 minutes past each hour** while you are logged in. It attempts installation when a phone has no recorded install or its last installed profile has **two days or less** left. The logged-in account needs noninteractive Git access to the configured origin. The Mac also needs network access for build dependencies and signing, and a connection to the phone to install. A failed attempt leaves that phone’s recorded expiration intact. The other phone is checked independently.

## Check renewal status

```sh
kit="$HOME/Library/Application Support/SettleDownRenewal"
/usr/bin/python3 "$kit/renew.py" --status
tail -n 30 "$HOME/Library/Logs/SettleDownRenewal.log"
```

Status shows the expiration from the helper’s **last successful install on each phone**, plus the Git commit for installs made with the updated helper. To retry a due install after unlocking or reconnecting a phone, run `/usr/bin/python3 "$kit/renew.py" --device maiphone`. To test renewal early, record the current expiration, then run the following on a later day:

```sh
/usr/bin/python3 "$kit/renew.py" --device ryan --renew-now
```

Check for a **later expiration date**. Xcode can reuse a cached profile. If the date is too early, the helper temporarily sets aside an identical cached copy of this app’s profile, keeps a backup in `$kit/profile-backups`, and retries with a clean build. It reinstalls only if the profile covers that phone, has more than two days remaining, and extends any recorded expiration. [Apple’s provisioning profile guide](https://developer.apple.com/help/account/provisioning-profiles/edit-download-or-delete-profiles/)

If a scheduled fetch fails, check the logged error and confirm the saved origin is reachable using credentials available to your logged-in macOS account. If you change Node installations, update `node` in `settings.ini` with the absolute path from `command -v node` after `nvm use`.

## Stop or resume the schedule

To disable the schedule and unload the running agent:

```sh
label=com.ryan.settledown.renew
launchctl disable "gui/$(id -u)/$label"
launchctl bootout "gui/$(id -u)/$label"
```

To resume with the existing settings and install records:

```sh
label=com.ryan.settledown.renew
launchctl enable "gui/$(id -u)/$label"
launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/$label.plist"
```
