#!/usr/bin/env bash
set -euo pipefail
binary="${1:?Expected .app path}"
evidence="${2:?Expected evidence directory}"
mkdir -p "$evidence"
runtime="$(xcrun simctl list runtimes --json | python3 -c 'import json,sys; r=[r for r in json.load(sys.stdin)["runtimes"] if r.get("isAvailable") and r["identifier"].startswith("com.apple.CoreSimulator.SimRuntime.iOS-")]; print(sorted(r,key=lambda r:tuple(map(int,r["version"].split("."))))[-1]["identifier"])')"
device="$(xcrun simctl create 'Settle Down CI' com.apple.CoreSimulator.SimDeviceType.iPhone-17 "$runtime")"
trap 'xcrun simctl shutdown "$device" >/dev/null 2>&1 || true; xcrun simctl delete "$device" >/dev/null 2>&1 || true' EXIT
xcrun simctl boot "$device"
xcrun simctl bootstatus "$device" -b
xcrun simctl install "$device" "$binary"
maestro --device "$device" test --format junit --output "$evidence/junit.xml" --test-output-dir "$evidence" .maestro/launch.yaml
