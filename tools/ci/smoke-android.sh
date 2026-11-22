#!/usr/bin/env bash
set -euo pipefail

evidence="${1:?Expected evidence directory}"
device="${ANDROID_SERIAL:-$(adb get-serialno)}"

# Only recover the recorded transport failure during launch, before UI assertions.
offline_during_launch() {
  python3 - "$1" "$device" <<'PY'
import json
import sys
from pathlib import Path

files = list(Path(sys.argv[1]).rglob("commands.json"))
if len(files) != 1:
    sys.exit(1)

with files[0].open() as source:
    commands = json.load(source)
failed = [item for item in commands if item.get("metadata", {}).get("status") == "FAILED"]
expected = f"Command failed (host:transport:{sys.argv[2]}): device offline"
if len(failed) != 1:
    sys.exit(1)
failure = failed[0]
offline_during_launch = (
    "launchAppCommand" in failure["command"]
    and failure["metadata"].get("error", {}).get("message") == expected
)
sys.exit(not offline_during_launch)
PY
}

wait_for_emulator() {
  timeout --kill-after=1s 30s bash -c '
    until [[ "$(adb -s "$1" shell getprop sys.boot_completed)" == 1 ]]; do
      sleep 1
    done
  ' _ "$device"
}

for attempt in 1 2; do
  attempt_dir="$evidence/attempt-$attempt"
  mkdir -p "$attempt_dir"
  status=0
  maestro --device "$device" test --format junit --output "$attempt_dir/junit.xml" \
    --test-output-dir "$attempt_dir" .maestro/launch.yaml 2>&1 | tee "$attempt_dir/maestro.log" || {
    statuses=("${PIPESTATUS[@]}")
    if (( statuses[1] != 0 )); then exit "${statuses[1]}"; fi
    status=${statuses[0]}
  }

  if (( status != 0 && attempt == 1 )) && offline_during_launch "$attempt_dir"; then
    echo "::warning::Maestro lost the ADB connection to $device during launch. Waiting up to 30 seconds for the emulator."
    if wait_for_emulator; then continue; fi
    echo "::error::ADB did not report a booted emulator on $device within 30 seconds."
  fi

  if [[ -f "$attempt_dir/junit.xml" ]]; then cp "$attempt_dir/junit.xml" "$evidence/junit.xml"; fi
  if (( status == 0 && attempt == 2 )); then
    message="Android smoke passed on the second attempt after the ADB connection to $device dropped during launch."
    echo "::notice::$message"
    if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then echo "$message" >> "$GITHUB_STEP_SUMMARY"; fi
  fi
  exit "$status"
done
