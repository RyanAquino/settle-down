#!/usr/bin/env bash
set -euo pipefail

: "${EXPO_TOKEN:?Set the EXPO_TOKEN repository Actions secret to publish previews}"
sha=$(git rev-parse HEAD)
if [[ "$TAG" != "expo-preview-$sha" ]]; then
  echo "::error::The preview tag must identify the staged commit."
  exit 1
fi
groups='{}'
for owner in org-ryan ryan.aquino; do
  updates=$(EAS_PROJECT_OWNER="$owner" eas update --branch expo-preview-staging \
    --environment preview --platform all --message "$TAG" --non-interactive --json)
  group=$(jq -er --arg sha "$sha" '
    select(map(.platform) | sort == ["android","ios"]) |
    select(all(.[]; .gitCommitHash == $sha and .branch == "expo-preview-staging")) |
    map(.group) | unique | select(length == 1) | .[0] | strings
  ' <<< "$updates")
  groups=$(jq -c --arg owner "$owner" --arg group "$group" '.[$owner] = $group' <<< "$groups")
done
echo "groups=$groups" >> "$GITHUB_OUTPUT"
