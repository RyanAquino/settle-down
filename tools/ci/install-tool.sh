#!/usr/bin/env bash
# Official release archives, pinned to the SHA-256 from GitHub release metadata.
set -euo pipefail
tool="${1:?Expected actionlint or gitleaks}"
destination="${2:?Expected an installation directory}"
platform="$(uname -s)-$(uname -m)"
case "$tool:$platform" in
  actionlint:Linux-x86_64) version=1.7.12; archive=actionlint_1.7.12_linux_amd64.tar.gz; sha=8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8 ;;
  actionlint:Darwin-arm64) version=1.7.12; archive=actionlint_1.7.12_darwin_arm64.tar.gz; sha=aba9ced2dee8d27fecca3dc7feb1a7f9a52caefa1eb46f3271ea66b6e0e6953f ;;
  gitleaks:Linux-x86_64) version=8.30.1; archive=gitleaks_8.30.1_linux_x64.tar.gz; sha=551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb ;;
  gitleaks:Darwin-arm64) version=8.30.1; archive=gitleaks_8.30.1_darwin_arm64.tar.gz; sha=b40ab0ae55c505963e365f271a8d3846efbc170aa17f2607f13df610a9aeb6a5 ;;
  *) echo "Unsupported tool/platform: $tool:$platform" >&2; exit 1 ;;
esac
case "$tool" in
  actionlint) repository=rhysd/actionlint ;;
  gitleaks) repository=gitleaks/gitleaks ;;
esac
workdir="$(mktemp -d)"
trap 'rm -rf "$workdir"' EXIT
curl --fail --location --retry 3 "https://github.com/$repository/releases/download/v$version/$archive" -o "$workdir/$archive"
(cd "$workdir" && printf '%s  %s\n' "$sha" "$archive" | shasum -a 256 --check)
mkdir -p "$destination"
tar -xzf "$workdir/$archive" -C "$destination" "$tool"
