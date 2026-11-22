"""Renew Settle Down independently on each configured iPhone."""

import argparse
import configparser
import fcntl
import json
import os
import plistlib
import re
import shutil
import subprocess
import sys
import tempfile
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path


HERE = Path.home() / "Library/Application Support/SettleDownRenewal"
CACHE = Path.home() / "Library/Caches/SettleDownRenewal"
ENV_FILES = (".env", ".env.local", ".env.production", ".env.production.local")
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


def config_file():
    config = configparser.ConfigParser(interpolation=None)
    with (HERE / "settings.ini").open() as stream:
        config.read_file(stream)
    return config


def install(team):
    if not re.fullmatch(r"[A-Z0-9]{10}", team):
        raise ValueError("Enter the 10-character Apple development team ID.")
    config = config_file()
    settings = config["build"] if "devices" in config else config["iphone"]
    root = Path(subprocess.check_output(
        ["git", "rev-parse", "--show-toplevel"], text=True
    ).strip())
    origin = subprocess.check_output(
        ["git", "remote", "get-url", "origin"], cwd=root, text=True
    ).strip()
    settings.pop("project", None)
    settings["origin"] = origin
    settings["team"] = team
    for name in ENV_FILES:
        source = root / name
        destination = HERE / name
        if source.is_file():
            shutil.copyfile(source, destination)
        elif destination.exists():
            destination.unlink()
    with (HERE / "settings.tmp").open("w") as stream:
        config.write(stream)
    (HERE / "settings.tmp").replace(HERE / "settings.ini")
    shutil.copyfile(__file__, HERE / "renew.py.tmp")
    (HERE / "renew.py.tmp").replace(HERE / "renew.py")
    report("Installed the renewal helper and saved the deployment configuration.")


def read_settings():
    config = config_file()
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
    return settings, devices


@contextmanager
def production_worktree(origin):
    CACHE.mkdir(parents=True, exist_ok=True)
    repo = HERE / "source.git"
    if not (repo / "HEAD").is_file():
        subprocess.run(["git", "init", "--bare", str(repo)], check=True)
    git = ["git", "--git-dir", str(repo)]
    subprocess.run([*git, "config", "remote.origin.url", origin], check=True)
    ref = "refs/remotes/origin/main"
    subprocess.run([*git, "fetch", "--no-tags", "origin", f"+refs/heads/main:{ref}"], check=True)
    commit = subprocess.check_output([*git, "rev-parse", ref], text=True).strip()
    report(f"Preparing origin/main at {commit}.")
    tree = CACHE / "worktree"
    if tree.exists():
        # Recover the helper's registered worktree after an interrupted deployment.
        subprocess.run([*git, "worktree", "remove", "--force", str(tree)], check=True)
    subprocess.run([*git, "worktree", "add", "--detach", "--force", str(tree), commit], check=True)
    try:
        for name in ENV_FILES:
            if (HERE / name).is_file():
                shutil.copyfile(HERE / name, tree / name)
        subprocess.run(["npm", "ci", "--include=dev"], cwd=tree, check=True)
        subprocess.run(["npx", "expo", "prebuild", "--platform", "ios", "--clean"], cwd=tree, check=True)
        yield tree, commit
    finally:
        subprocess.run([*git, "worktree", "remove", "--force", str(tree)], check=True)


def build(project, device, derived, team, clean=False):
    report("Building the Release configuration with Xcode.")
    args = [
        "/usr/bin/xcodebuild", "-quiet",
        "-workspace", str(project / "ios/SettleDown.xcworkspace"),
        "-scheme", "SettleDown", "-configuration", "Release",
        "-destination", f"platform=iOS,id={device}", "-destination-timeout", "35",
        "-derivedDataPath", str(derived),
        "CODE_SIGN_STYLE=Automatic", f"DEVELOPMENT_TEAM={team}",
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
    if team not in profile.get("TeamIdentifier", []):
        raise ValueError("The embedded profile belongs to a different team.")
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


def renew_phone(name, device, settings, status_only, renew_now):
    report(f"Checking {name}.")
    receipt = HERE / f"installed-{device}.json"
    previous = None
    if receipt.exists():
        record = json.loads(receipt.read_text())
        previous = datetime.fromisoformat(record["expires"])
        if "commit" in record:
            report(f"Last installed commit: {record['commit']}.")
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
    team = settings["team"]
    with production_worktree(settings["origin"]) as (project, commit):
        derived = CACHE / "DerivedData"
        app, profile, expiry = build(project, device, derived, team)
        # Xcode can reuse a valid profile even when the build succeeds.
        if expiry <= required_expiry:
            with set_cached_profile_aside(app, profile):
                app, _, expiry = build(project, device, derived, team, clean=True)
        if expiry <= required_expiry:
            raise ValueError("Xcode did not supply a sufficiently fresh profile. The next scheduled check will retry.")
        subprocess.run([
            "/usr/bin/xcrun", "devicectl", "device", "install", "app",
            "--device", device, "--timeout", "180", str(app),
        ], check=True)
        pending = receipt.with_suffix(".tmp")
        pending.write_text(json.dumps({"expires": expiry.isoformat(), "commit": commit}) + "\n")
        pending.replace(receipt)
        report(f"Installed Settle Down on {name} from {commit}. Profile expires {display(expiry)}.")


def build_environment(settings):
    node = Path(settings["node"]).expanduser()
    if not node.is_absolute() or not os.access(node, os.X_OK):
        raise ValueError(f"Cannot run {node}. Update the node setting after running nvm use.")
    os.environ.update(NODE_BINARY=str(node), NODE_ENV="production", CI="1",
                      LANG="en_US.UTF-8", GIT_TERMINAL_PROMPT="0")
    os.environ["PATH"] = f"{node.parent}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"


def run(status_only, renew_now, selected):
    settings, devices = read_settings()
    if selected:
        if selected not in devices:
            raise ValueError(f"Unknown device {selected}. Choose from {', '.join(devices)}.")
        devices = {selected: devices[selected]}
    if not status_only:
        build_environment(settings)

    success = True
    for name, device in devices.items():
        try:
            renew_phone(name, device, settings, status_only, renew_now)
        except RENEWAL_ERRORS as error:
            report(f"{name} is pending. {error}")
            success = False
    return success


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--device", help="check one device alias from settings.ini (default: all)")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--install", metavar="TEAM_ID", help="install from this checkout and save its production environment")
    mode.add_argument("--status", action="store_true", help="show the last recorded install and renewal dates")
    mode.add_argument("--renew-now", action="store_true", help="try for a later expiration even when the last install is still fresh")
    args = parser.parse_args()
    os.umask(0o077)
    try:
        if args.install:
            HERE.mkdir(parents=True, exist_ok=True)
        with (HERE / "renew.lock").open("a") as lock:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                report("A renewal is already running.")
                if args.install:
                    sys.exit(1)
            else:
                if args.install:
                    install(args.install)
                elif not run(args.status, args.renew_now, args.device):
                    sys.exit(1)
    except RENEWAL_ERRORS as error:
        report(f"Renewal stopped: {error}")
        sys.exit(1)
