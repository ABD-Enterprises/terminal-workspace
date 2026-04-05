#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT_DIR/scripts/load-env.sh"

CHANNEL="${MACOS_RELEASE_CHANNEL:-stable}"
PROMOTED_MANIFEST_PATH="$ROOT_DIR/artifacts/release/promoted/$CHANNEL/latest-macos-release.json"
DRY_RUN="${RELEASE_DRY_RUN:-0}"
RELEASE_TARGET="${RELEASE_TARGET:-}"

if [[ ! -f "$PROMOTED_MANIFEST_PATH" ]]; then
  echo "Promoted release manifest not found at $PROMOTED_MANIFEST_PATH" >&2
  exit 1
fi

mapfile -t PUBLISH_INFO < <(MANIFEST_PATH="$PROMOTED_MANIFEST_PATH" node <<'NODE'
const fs = require("node:fs");
const path = require("node:path");

const manifest = JSON.parse(fs.readFileSync(process.env.MANIFEST_PATH, "utf8"));
const promotionDirectory = manifest.promotion?.directory;

if (!promotionDirectory || !fs.existsSync(promotionDirectory)) {
  throw new Error(`Promotion directory missing: ${promotionDirectory ?? "unknown"}`);
}

const version = manifest.version;
const tag = process.env.RELEASE_TAG || `v${version}`;
const releaseName = process.env.RELEASE_NAME || `Terminal Workspace ${tag}`;
const releaseNotesPath = manifest.promotion?.releaseNotesPath || "";
const latestManifestPath = manifest.promotion?.latestManifestPath || process.env.MANIFEST_PATH;
const assetPaths = fs.readdirSync(promotionDirectory)
  .sort((left, right) => left.localeCompare(right))
  .map((entry) => path.join(promotionDirectory, entry));

if (!assetPaths.includes(latestManifestPath) && fs.existsSync(latestManifestPath)) {
  assetPaths.push(latestManifestPath);
}

console.log(version);
console.log(tag);
console.log(releaseName);
console.log(promotionDirectory);
console.log(releaseNotesPath);
console.log(JSON.stringify(assetPaths));
NODE
)

VERSION="${PUBLISH_INFO[0]}"
RELEASE_TAG="${PUBLISH_INFO[1]}"
RELEASE_NAME="${PUBLISH_INFO[2]}"
PROMOTION_DIRECTORY="${PUBLISH_INFO[3]}"
RELEASE_NOTES_PATH="${PUBLISH_INFO[4]}"
ASSET_PATHS_JSON="${PUBLISH_INFO[5]}"

mapfile -t ASSET_PATHS < <(ASSET_PATHS_JSON="$ASSET_PATHS_JSON" node <<'NODE'
const assets = JSON.parse(process.env.ASSET_PATHS_JSON);
for (const asset of assets) {
  console.log(asset);
}
NODE
)

if [[ "$DRY_RUN" == "1" ]]; then
  echo "Dry-run GitHub release publish"
  echo "  version: $VERSION"
  echo "  tag: $RELEASE_TAG"
  echo "  name: $RELEASE_NAME"
  echo "  channel: $CHANNEL"
  if [[ -n "$RELEASE_TARGET" ]]; then
    echo "  target: $RELEASE_TARGET"
  fi
  echo "  promotion directory: $PROMOTION_DIRECTORY"
  if [[ -n "$RELEASE_NOTES_PATH" ]]; then
    echo "  release notes: $RELEASE_NOTES_PATH"
  fi
  printf '  assets:\n'
  printf '    %s\n' "${ASSET_PATHS[@]}"
  exit 0
fi

if ! command -v gh >/dev/null 2>&1; then
  echo "GitHub CLI is required to publish promoted releases." >&2
  exit 1
fi

: "${GITHUB_REPOSITORY:?Set GITHUB_REPOSITORY before publishing a release.}"

if ! gh release view "$RELEASE_TAG" --repo "$GITHUB_REPOSITORY" >/dev/null 2>&1; then
  create_args=(
    gh release create "$RELEASE_TAG"
    --repo "$GITHUB_REPOSITORY"
    --title "$RELEASE_NAME"
  )

  if [[ -n "$RELEASE_TARGET" ]]; then
    create_args+=(--target "$RELEASE_TARGET")
  fi

  if [[ "$CHANNEL" != "stable" ]]; then
    create_args+=(--prerelease)
  fi

  if [[ -n "$RELEASE_NOTES_PATH" && -f "$RELEASE_NOTES_PATH" ]]; then
    create_args+=(--notes-file "$RELEASE_NOTES_PATH")
  else
    create_args+=(--notes "Automated macOS release promotion for version $VERSION.")
  fi

  "${create_args[@]}"
fi

gh release upload "$RELEASE_TAG" --repo "$GITHUB_REPOSITORY" --clobber "${ASSET_PATHS[@]}"

echo "Published GitHub release $RELEASE_TAG with ${#ASSET_PATHS[@]} assets."
