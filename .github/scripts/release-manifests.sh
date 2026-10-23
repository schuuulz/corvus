#!/usr/bin/env bash
# Writes the release's update manifest (latest.json, read by the in-app
# updater) and SHA256SUMS.txt, then attaches both to the release.
#
#   release-manifests.sh <tag> <version>
#
# Runs once every installer is attached, so the manifest is built in one
# place instead of each build job racing to edit it.
set -euo pipefail

tag=$1
version=$2
repo=${GITHUB_REPOSITORY:?}
work=$(mktemp -d)

gh release download "$tag" --repo "$repo" --dir "$work"
cd "$work"
rm -f latest.json SHA256SUMS.txt

# One updater entry per platform: the bundle and its minisign signature.
entry() {
  local platform=$1 pattern=$2 file
  file=$(ls | grep -E "$pattern" | grep -v '\.sig$' | head -n 1 || true)
  if [ -z "$file" ] || [ ! -f "$file.sig" ]; then
    echo "no updater bundle for $platform" >&2
    return 0
  fi
  jq -n --arg platform "$platform" \
    --arg url "https://github.com/$repo/releases/download/$tag/$file" \
    --rawfile signature "$file.sig" \
    '{($platform): {url: $url, signature: $signature}}'
}

platforms=$(
  {
    entry windows-x86_64 '-setup\.exe$'
    entry linux-x86_64 '\.AppImage$'
    entry darwin-aarch64 '_aarch64\.app\.tar\.gz$'
    entry darwin-x86_64 '_x64\.app\.tar\.gz$'
  } | jq -s 'add // {}'
)
jq -n --arg version "$version" --arg date "$(date -u +%Y-%m-%dT%H:%M:%SZ)" --argjson platforms "$platforms" \
  '{version: $version, pub_date: $date, platforms: $platforms}' >latest.json

sha256sum -- $(ls | grep -v -E '\.sig$|^latest\.json$') >SHA256SUMS.txt

cat latest.json
gh release upload "$tag" latest.json SHA256SUMS.txt --repo "$repo" --clobber
