#!/usr/bin/env bash
set -euo pipefail
runtime=$(xcrun simctl list runtimes --json | python3 -c '
import json
import sys
available = [
    runtime for runtime in json.load(sys.stdin)["runtimes"]
    if runtime.get("isAvailable") and runtime["identifier"].startswith("com.apple.CoreSimulator.SimRuntime.iOS-")
]
latest = max(available, key=lambda runtime: tuple(map(int, runtime["version"].split("."))))
print(latest["identifier"])
')
device="$(xcrun simctl create 'Settle Down CI' com.apple.CoreSimulator.SimDeviceType.iPhone-17 "$runtime")"
if ! xcrun simctl boot "$device" >&2; then
  xcrun simctl delete "$device" >&2
  exit 1
fi
echo "$device"
