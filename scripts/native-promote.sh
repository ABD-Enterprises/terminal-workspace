#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MANIFEST_PATH="$ROOT_DIR/artifacts/release/latest-macos-release.json"
CHANNEL="${MACOS_RELEASE_CHANNEL:-stable}"

if [[ ! -f "$MANIFEST_PATH" ]]; then
  echo "Release manifest not found at $MANIFEST_PATH" >&2
  exit 1
fi

mapfile -t PROMOTION_INFO < <(MANIFEST_PATH="$MANIFEST_PATH" node <<'NODE'
const fs = require("node:fs");
const manifest = JSON.parse(fs.readFileSync(process.env.MANIFEST_PATH, "utf8"));

if (manifest.notarization?.status !== "Accepted") {
  throw new Error(`Release is not notarized: ${manifest.notarization?.status ?? "missing"}`);
}

if (manifest.notarization?.stapleValidateStatus !== "passed") {
  throw new Error(`Stapled ticket is not validated: ${manifest.notarization?.stapleValidateStatus ?? "missing"}`);
}

if (manifest.verification?.spctlStatus !== "accepted") {
  throw new Error(`Gatekeeper assessment is not accepted: ${manifest.verification?.spctlStatus ?? "missing"}`);
}

console.log(manifest.version);
console.log(manifest.archive.path);
console.log(manifest.manifest?.path || process.env.MANIFEST_PATH);
console.log(manifest.manifest?.latestPath || process.env.MANIFEST_PATH);
console.log(JSON.stringify({
  codesignVerifyLog: manifest.verification?.codesignVerifyLog || null,
  codesignDisplayLog: manifest.verification?.codesignDisplayLog || null,
  spctlLog: manifest.verification?.spctlLog || null,
  notarySubmit: manifest.notarization?.submitLog || null,
  notaryLog: manifest.notarization?.notaryLog || null,
  stapleLog: manifest.notarization?.stapleLog || null,
  stapleValidateLog: manifest.notarization?.stapleValidateLog || null
}));
NODE
)

VERSION="${PROMOTION_INFO[0]}"
ZIP_PATH="${PROMOTION_INFO[1]}"
VERSIONED_MANIFEST_PATH="${PROMOTION_INFO[2]}"
LATEST_MANIFEST_PATH="${PROMOTION_INFO[3]}"
EXTRA_LOGS_JSON="${PROMOTION_INFO[4]}"
PROMOTION_ROOT="$ROOT_DIR/artifacts/release/promoted/$CHANNEL/v$VERSION"
CHANNEL_ROOT="$ROOT_DIR/artifacts/release/promoted/$CHANNEL"
PROMOTED_MANIFEST_PATH="$PROMOTION_ROOT/release.json"
LATEST_PROMOTED_MANIFEST_PATH="$CHANNEL_ROOT/latest-macos-release.json"
CHECKSUM_PATH="$PROMOTION_ROOT/SHA256SUMS.txt"
PATCH_JSON="$PROMOTION_ROOT/promotion-patch.json"

mkdir -p "$PROMOTION_ROOT" "$CHANNEL_ROOT"

cp "$ZIP_PATH" "$PROMOTION_ROOT/"
cp "$VERSIONED_MANIFEST_PATH" "$PROMOTED_MANIFEST_PATH"

EXTRA_LOGS_JSON="$EXTRA_LOGS_JSON" PROMOTION_ROOT="$PROMOTION_ROOT" node <<'NODE'
const fs = require("node:fs");
const path = require("node:path");

const logs = JSON.parse(process.env.EXTRA_LOGS_JSON);
const destination = process.env.PROMOTION_ROOT;

for (const filePath of Object.values(logs)) {
  if (!filePath || !fs.existsSync(filePath)) {
    continue;
  }
  fs.copyFileSync(filePath, path.join(destination, path.basename(filePath)));
}
NODE

ARCHIVE_BASENAME="$(basename "$ZIP_PATH")"
ARCHIVE_SHA256="$(shasum -a 256 "$ZIP_PATH" | awk '{print $1}')"
printf "%s  %s\n" "$ARCHIVE_SHA256" "$ARCHIVE_BASENAME" >"$CHECKSUM_PATH"

PATCH_JSON="$PATCH_JSON" CHANNEL="$CHANNEL" PROMOTION_ROOT="$PROMOTION_ROOT" LATEST_PROMOTED_MANIFEST_PATH="$LATEST_PROMOTED_MANIFEST_PATH" CHECKSUM_PATH="$CHECKSUM_PATH" PROMOTED_AT="$(date -Iseconds)" node <<'NODE'
const fs = require("node:fs");

const patch = {
  promotion: {
    status: "promoted",
    channel: process.env.CHANNEL,
    promotedAt: process.env.PROMOTED_AT,
    directory: process.env.PROMOTION_ROOT,
    latestManifestPath: process.env.LATEST_PROMOTED_MANIFEST_PATH,
    checksumPath: process.env.CHECKSUM_PATH,
  }
};

fs.writeFileSync(process.env.PATCH_JSON, `${JSON.stringify(patch, null, 2)}\n`);
NODE

node "$ROOT_DIR/scripts/native-release-annotate.mjs" "$VERSIONED_MANIFEST_PATH" "$PATCH_JSON"
if [[ "$LATEST_MANIFEST_PATH" != "$VERSIONED_MANIFEST_PATH" ]]; then
  cp "$VERSIONED_MANIFEST_PATH" "$LATEST_MANIFEST_PATH"
fi
cp "$VERSIONED_MANIFEST_PATH" "$PROMOTED_MANIFEST_PATH"
cp "$VERSIONED_MANIFEST_PATH" "$LATEST_PROMOTED_MANIFEST_PATH"

echo
echo "Promoted notarized release:"
echo "  channel: $CHANNEL"
echo "  directory: $PROMOTION_ROOT"
echo "  latest manifest: $LATEST_PROMOTED_MANIFEST_PATH"
