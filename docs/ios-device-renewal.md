# Install and renew Settle Down on iPhones with Xcode

This installs Settle Down as its own app on a physical iPhone. Expo Prebuild generates the `ios/` project. Xcode signs and builds it. The Release build includes the JavaScript bundle so you can open it away from the Mac. [Expo local build guide](https://docs.expo.dev/guides/local-app-development/)

With a free Apple Personal Team, a provisioning profile expires seven days after Apple issues it. One Mac can renew the app independently on two paired iPhones. If you've already installed the renewal helper, jump to [Check renewal status](#check-renewal-status). [Apple’s Personal Team limits](https://developer.apple.com/help/account/basics/about-your-developer-account/)

## 1. Prepare the workspace and pair the phones

Use a Mac with Xcode, your Apple account signed in to Xcode, and the checkout you want to deploy. **Every renewal builds the current contents of that checkout, including local edits.** Run the setup commands in Terminal from the repository root.

On a fresh checkout:

```sh
nvm use
npm ci
test -f .env || cp .env.sample .env
```

Set `EXPO_PUBLIC_API_BASE_URL` in `.env` to a backend both phones can reach. Then generate the native project and open the CocoaPods workspace:

```sh
npx expo prebuild --platform ios
open ios/SettleDown.xcworkspace
```

If you already have a working `ios/SettleDown.xcworkspace`, open it directly. Run prebuild again when native dependencies or Expo configuration change. Adding `--clean` replaces the generated `ios/` directory, including manual Xcode edits.

To move an existing renewal build to the org's Expo project, run `npx expo prebuild --platform ios` in the renewal checkout after pulling the org configuration. The next Release build will embed the org update URL. Install that build on each phone.

1. Select the **SettleDown** app target in Xcode. Under **Signing & Capabilities**, enable **Automatically manage signing**, select your Personal Team for the Release configuration, and keep the bundle identifier `com.ryan.aquino.settledown`.
2. Unlock each phone and connect it to the Mac by USB for initial pairing. Accept **Trust This Computer** and enable **Developer Mode** if prompted. In Xcode, open **Device Hub** from **Xcode → Open Developer Tool**, select the phone, and resolve any pairing prompts. A paired phone can subsequently connect over the same Wi-Fi. [Apple’s device pairing guide](https://developer.apple.com/documentation/xcode/managing-your-simulated-and-physical-devices-in-device-hub)
3. Run `xcrun devicectl list devices` and copy each physical iPhone’s hardware **UDID**. The examples below use `ryan` for the iPhone 16 Pro and `maiphone` for the iPhone 13 mini. The aliases are local labels. You can configure both while one is away.

To deploy manually from Xcode, choose the **SettleDown** scheme and the iPhone as the run destination. For a standalone build, select **Product → Scheme → Edit Scheme → Run → Build Configuration → Release**, then press **⌘R**. The renewal helper uses the same workspace and Release configuration.

## 2. Install the renewal helper and configure the devices

Expand the block below and run it once to save the helper on your Mac. The helper checks the provisioning profile in the built app, installs it with `devicectl`, and records the expiration only after installation succeeds.

<details>
<summary>Copy the Terminal command to create the renewal helper</summary>

```sh
kit="$HOME/Library/Application Support/SettleDownRenewal"
mkdir -p "$kit"
cat > "$kit/renew.py" <<'PY'
"""Renew Settle Down independently on each configured iPhone."""

import argparse
import configparser
import fcntl
import json
import os
import plistlib
import re
import subprocess
import sys
import tempfile
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path


HERE = Path(__file__).resolve().parent
BUNDLE_ID = "com.ryan.aquino.settledown"
LEAD_TIME = timedelta(days=2)
RENEWAL_ERRORS = (OSError, ValueError, KeyError, configparser.Error,
                  plistlib.InvalidFileException, subprocess.SubprocessError)
PROFILE_CACHES = (
    Path.home() / "Library/Developer/Xcode/UserData/Provisioning Profiles",
    Path.home() / "Library/MobileDevice/Provisioning Profiles",
)


def display(date):
    return date.astimezone().strftime("%Y-%m-%d %H:%M %Z")


def report(message):
    print(f"[{display(datetime.now(timezone.utc))}] {message}", flush=True)


def read_settings():
    config = configparser.ConfigParser(interpolation=None)
    with (HERE / "settings.ini").open() as stream:
        config.read_file(stream)
    if "devices" in config:
        settings = config["build"]
        devices = dict(config["devices"])
    else:
        settings = config["iphone"]
        devices = {"iphone": settings["udid"]}
    devices = {name: udid.strip().upper() for name, udid in devices.items()}
    if not devices or len(set(devices.values())) != len(devices):
        raise ValueError("Enter one distinct hardware UDID for each iPhone in settings.ini.")
    for name, udid in devices.items():
        if not re.fullmatch(r"(?:[0-9A-F]{8}-[0-9A-F]{16}|[0-9A-F]{40})", udid):
            raise ValueError(f"Invalid iPhone hardware UDID for {name} in settings.ini.")
    return Path(settings["project"]).expanduser(), Path(settings["node"]).expanduser(), devices


def build(project, device, derived, clean=False):
    report("Building the Release configuration with Xcode.")
    args = [
        "/usr/bin/xcodebuild", "-quiet",
        "-workspace", str(project / "ios/SettleDown.xcworkspace"),
        "-scheme", "SettleDown", "-configuration", "Release",
        "-destination", f"platform=iOS,id={device}", "-destination-timeout", "35",
        "-derivedDataPath", str(derived),
        "-allowProvisioningUpdates", "-allowProvisioningDeviceRegistration",
    ]
    if clean:
        args.append("clean")
    subprocess.run([*args, "build"], cwd=project, check=True)
    app = derived / "Build/Products/Release-iphoneos/SettleDown.app"
    with (app / "Info.plist").open("rb") as stream:
        if plistlib.load(stream)["CFBundleIdentifier"] != BUNDLE_ID:
            raise ValueError(f"Expected a build of {BUNDLE_ID}. Check the Xcode target.")
    embedded = app / "embedded.mobileprovision"
    profile = plistlib.loads(subprocess.check_output(
        ["/usr/bin/security", "cms", "-D", "-i", str(embedded)]
    ))
    if device not in {d.upper() for d in profile.get("ProvisionedDevices", [])}:
        raise ValueError("The profile does not include the configured iPhone.")
    expiry = profile["ExpirationDate"].replace(tzinfo=timezone.utc)
    report(f"Xcode embedded a profile expiring {display(expiry)}.")
    return app, profile, expiry


@contextmanager
def set_cached_profile_aside(app, profile):
    # Move only a byte-for-byte copy of THIS app's embedded, app-specific profile.
    app_id = profile["Entitlements"]["application-identifier"]
    if app_id.partition(".")[2] != BUNDLE_ID:
        raise ValueError("Xcode reused a shared profile. Check signing for the SettleDown target in Xcode.")
    embedded = (app / "embedded.mobileprovision").read_bytes()
    matches = [
        entry for cache in PROFILE_CACHES for entry in cache.glob("*.mobileprovision")
        if entry.is_file() and entry.read_bytes() == embedded
    ]
    if not matches:
        report("No identical profile in Xcode's caches. Trying a clean build.")
        yield
        return

    backups = HERE / "profile-backups"
    backups.mkdir(exist_ok=True)
    backup_dir = Path(tempfile.mkdtemp(prefix="profile-", dir=backups))
    moved = []
    try:
        for index, original in enumerate(matches):
            backup = backup_dir / f"{index}-{original.name}"
            original.rename(backup)
            moved.append((original, backup))
        report(f"Temporarily set aside profile {profile['UUID']}. Backup in {backup_dir}.")
        yield
    finally:
        for original, backup in moved:
            # Restore without overwriting anything Xcode may have downloaded.
            try:
                os.link(backup, original)
            except FileExistsError:
                pass


def renew_phone(name, device, project, status_only, renew_now):
    report(f"Checking {name}.")
    receipt = HERE / f"installed-{device}.json"
    previous = None
    if receipt.exists():
        previous = datetime.fromisoformat(json.loads(receipt.read_text())["expires"])
        report(f"Last successful install expires {display(previous)}. Renewal due {display(previous - LEAD_TIME)}.")
    else:
        report("First run. A successful install will establish the expiration date.")
    if status_only:
        return
    cutoff = datetime.now(timezone.utc) + LEAD_TIME
    if previous and previous > cutoff and not renew_now:
        return
    required_expiry = max(previous, cutoff) if previous else cutoff
    # A live device request avoids starting a build for a phone that is away.
    subprocess.run([
        "/usr/bin/xcrun", "devicectl", "device", "info", "lockState",
        "--device", device, "--timeout", "15", "--quiet",
    ], check=True, timeout=25)
    derived = Path.home() / "Library/Caches/SettleDownRenewal/DerivedData"
    app, profile, expiry = build(project, device, derived)
    # Xcode can reuse a valid profile even when the build succeeds.
    if expiry <= required_expiry:
        with set_cached_profile_aside(app, profile):
            app, _, expiry = build(project, device, derived, clean=True)
    if expiry <= required_expiry:
        raise ValueError("Xcode did not supply a sufficiently fresh profile. The next scheduled check will retry.")
    subprocess.run([
        "/usr/bin/xcrun", "devicectl", "device", "install", "app",
        "--device", device, "--timeout", "180", str(app),
    ], check=True)
    pending = receipt.with_suffix(".tmp")
    pending.write_text(json.dumps({"expires": expiry.isoformat()}) + "\n")
    pending.replace(receipt)
    report(f"Installed Settle Down on {name}. Profile expires {display(expiry)}.")


def run(status_only, renew_now, selected):
    project, node, devices = read_settings()
    if selected:
        if selected not in devices:
            raise ValueError(f"Unknown device {selected}. Choose from {', '.join(devices)}.")
        devices = {selected: devices[selected]}
    if not status_only:
        # Check launchd's access even when both installs are still fresh.
        with (project / "ios/SettleDown.xcworkspace/contents.xcworkspacedata").open("rb") as workspace:
            workspace.read(1)
        if not node.is_absolute() or not os.access(node, os.X_OK):
            raise ValueError(f"Cannot run {node}. Update the node setting after running nvm use.")
        os.environ["NODE_BINARY"] = str(node)
        os.environ["PATH"] = f"{node.parent}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

    success = True
    for name, device in devices.items():
        try:
            renew_phone(name, device, project, status_only, renew_now)
        except RENEWAL_ERRORS as error:
            report(f"{name} is pending. {error}")
            success = False
    return success


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--device", help="check one device alias from settings.ini (default: all)")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--status", action="store_true", help="show the last recorded install and renewal dates")
    mode.add_argument("--renew-now", action="store_true", help="try for a later expiration even when the last install is still fresh")
    args = parser.parse_args()
    os.umask(0o077)
    try:
        with (HERE / "renew.lock").open("a") as lock:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                report("A renewal is already running.")
            else:
                if not run(args.status, args.renew_now, args.device):
                    sys.exit(1)
    except RENEWAL_ERRORS as error:
        report(f"Renewal stopped: {error}")
        sys.exit(1)
PY
```

</details>

From the **repository root**, replace the two UDID placeholders before running this block. Keep actual UDIDs in this local settings file. For a single phone, omit the other device line. If `settings.ini` already contains your devices, keep it.

```sh
nvm use
kit="$HOME/Library/Application Support/SettleDownRenewal"

cat > "$kit/settings.ini" <<EOF
[build]
project = $PWD
node = $(command -v node)

[devices]
ryan = REPLACE_WITH_IPHONE_16_PRO_UDID
maiphone = REPLACE_WITH_IPHONE_13_MINI_UDID
EOF
```

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

The agent checks at login and **15 minutes past each hour** while you are logged in. It attempts installation when a phone has no recorded install or its last installed profile has **two days or less** left. The Mac needs internet access to request a new profile and a connection to the phone to install. A failed attempt leaves that phone’s recorded expiration intact. The other phone is checked independently.

## Check renewal status

```sh
kit="$HOME/Library/Application Support/SettleDownRenewal"
/usr/bin/python3 "$kit/renew.py" --status
tail -n 30 "$HOME/Library/Logs/SettleDownRenewal.log"
```

Status shows the expiration from the helper’s **last successful install on each phone**. To retry a due install after unlocking or reconnecting a phone, run `/usr/bin/python3 "$kit/renew.py" --device maiphone`. To test renewal early, record the current expiration, then run the following on a later day:

```sh
/usr/bin/python3 "$kit/renew.py" --device ryan --renew-now
```

Check for a **later expiration date**. Xcode can reuse a cached profile. If the date is too early, the helper temporarily sets aside an identical cached copy of this app’s profile, keeps a backup in `$kit/profile-backups`, and retries with a clean build. It reinstalls only if the profile covers that phone, has more than two days remaining, and extends any recorded expiration. [Apple’s provisioning profile guide](https://developer.apple.com/help/account/provisioning-profiles/edit-download-or-delete-profiles/)

If the manual command works but the scheduled run logs `Operation not permitted` for a checkout on the Desktop, use a checkout under `~/Developer`. Configure its `.env` and signed workspace, update `project` in `settings.ini`, then run `launchctl kickstart "gui/$(id -u)/com.ryan.settledown.renew"`. If you change Node installations, update `node` with the absolute path from `command -v node` after `nvm use`.

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
