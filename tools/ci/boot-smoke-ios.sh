#!/usr/bin/env bash
set -euo pipefail
runtime="$(xcrun simctl list runtimes --json | python3 -c 'import json,sys; r=[r for r in json.load(sys.stdin)["runtimes"] if r.get("isAvailable") and r["identifier"].startswith("com.apple.CoreSimulator.SimRuntime.iOS-")]; print(sorted(r,key=lambda r:tuple(map(int,r["version"].split("."))))[-1]["identifier"])')"
device="$(xcrun simctl create 'Settle Down CI' com.apple.CoreSimulator.SimDeviceType.iPhone-17 "$runtime")"
if ! xcrun simctl boot "$device" >&2; then
  xcrun simctl delete "$device" >&2
  exit 1
fi
echo "$device"
