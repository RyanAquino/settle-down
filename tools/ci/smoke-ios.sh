#!/usr/bin/env bash
set -euo pipefail
binary="${1:?Expected .app path}"
evidence="${2:?Expected evidence directory}"
mkdir -p "$evidence"
device="${3:-$(bash "$(dirname "$0")/boot-smoke-ios.sh")}"
trap 'xcrun simctl shutdown "$device" >/dev/null 2>&1 || true; xcrun simctl delete "$device" >/dev/null 2>&1 || true' EXIT
xcrun simctl bootstatus "$device" -b
xcrun simctl install "$device" "$binary"
maestro --device "$device" test --format junit --output "$evidence/junit.xml" --test-output-dir "$evidence" .maestro/launch.yaml
