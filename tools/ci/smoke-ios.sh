#!/usr/bin/env bash
set -euo pipefail
binary="${1:?Expected .app path}"
evidence="${2:?Expected evidence directory}"
mkdir -p "$evidence"
runtime="$(xcrun simctl list runtimes --json | python3 -c 'import json,sys; r=[r for r in json.load(sys.stdin)["runtimes"] if r.get("isAvailable") and r["identifier"].startswith("com.apple.CoreSimulator.SimRuntime.iOS-")]; print(sorted(r,key=lambda r:tuple(map(int,r["version"].split("."))))[-1]["identifier"])')"
device=''
cleanup_device() {
  if [[ -n "$device" ]]; then
    xcrun simctl shutdown "$device" >/dev/null 2>&1 || true
    xcrun simctl delete "$device" >/dev/null 2>&1 || true
    device=''
  fi
}
trap cleanup_device EXIT

timeout_exception='xcuitest.installer.LocalXCTestInstaller$IOSDriverTimeoutException: iOS driver not ready in time'
for attempt in 1 2; do
  attempt_dir="$evidence/attempt-$attempt"
  mkdir -p "$attempt_dir"
  device="$(xcrun simctl create 'Settle Down CI' com.apple.CoreSimulator.SimDeviceType.iPhone-17 "$runtime")"
  xcrun simctl boot "$device"
  xcrun simctl bootstatus "$device" -b
  xcrun simctl install "$device" "$binary"

  status=0
  maestro --device "$device" test --format junit --output "$attempt_dir/junit.xml" \
    --test-output-dir "$attempt_dir" .maestro/launch.yaml 2>&1 | tee "$attempt_dir/maestro.log" || {
    statuses=("${PIPESTATUS[@]}")
    if (( statuses[1] != 0 )); then exit "${statuses[1]}"; fi
    status=${statuses[0]}
  }
  if (( status != 0 && attempt == 1 )) && grep -Fq "$timeout_exception" "$attempt_dir/maestro.log"; then
    echo '::warning::Maestro timed out starting its XCTest driver. Retrying on a fresh simulator.'
    cleanup_device
    continue
  fi

  if [[ -f "$attempt_dir/junit.xml" ]]; then cp "$attempt_dir/junit.xml" "$evidence/junit.xml"; fi
  if (( status == 0 && attempt == 2 )) && [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
    echo 'iOS smoke passed on a fresh simulator after the first Maestro XCTest driver startup timed out.' >> "$GITHUB_STEP_SUMMARY"
  fi
  exit "$status"
done
