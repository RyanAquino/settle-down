#!/usr/bin/env bash
set -euo pipefail
destination="${1:?Expected installation directory}"
mkdir -p "$destination"
archive="$destination/maestro.zip"
curl --fail --location --retry 3 https://github.com/mobile-dev-inc/Maestro/releases/download/cli-2.12.1/maestro.zip -o "$archive"
printf '%s  %s\n' 54dbb0716425626604973cbb374c585ca30272375d9ce15177a1152765ddd9d7 "$archive" | shasum -a 256 --check
unzip -qo "$archive" -d "$destination"
