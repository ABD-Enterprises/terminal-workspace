#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT_DIR/scripts/load-env.sh"
MANIFEST_PATH="$ROOT_DIR/artifacts/release/latest-macos-release.json"
: "${MACOS_SIGN_MODE:=require}"
export MACOS_SIGN_MODE

bash "$ROOT_DIR/scripts/native-bundle.sh"

if [[ ! -f "$MANIFEST_PATH" ]]; then
  echo "Release manifest not found at $MANIFEST_PATH" >&2
  exit 1
fi

MANIFEST_PATH="$MANIFEST_PATH" node <<'NODE'
const fs = require("node:fs");

const manifestPath = process.env.MANIFEST_PATH;
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

if (!manifest.bundle?.exists) {
  throw new Error(`Bundle missing: ${manifest.bundle?.path ?? "unknown"}`);
}

if (!manifest.archive?.exists || !manifest.archive?.bytes) {
  throw new Error(`Archive missing or empty: ${manifest.archive?.path ?? "unknown"}`);
}

if (!manifest.executable?.exists || !manifest.executable?.sha256) {
  throw new Error(`Executable missing or unhashed: ${manifest.executable?.path ?? "unknown"}`);
}

if (manifest.signing?.performed && manifest.verification?.codesignStatus !== "passed") {
  throw new Error(`codesign verification failed: ${manifest.verification?.codesignStatus}`);
}

console.log(JSON.stringify({
  productName: manifest.productName,
  version: manifest.version,
  identifier: manifest.identifier,
  signing: manifest.signing,
  verification: manifest.verification,
  archive: manifest.archive
}, null, 2));
NODE
