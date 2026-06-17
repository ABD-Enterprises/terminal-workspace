#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT_DIR/scripts/load-env.sh"
MANIFEST_PATH="$ROOT_DIR/artifacts/release/latest-macos-release.json"
CHANNEL="${MACOS_RELEASE_CHANNEL:-stable}"
NOTARY_PROFILE="${MACOS_NOTARY_PROFILE:-${NOTARY_PROFILE:-}}"
VOLUME_NAME="Terminal Workspace"
STAGING_DIR=""
NOTARY_SUBMIT_JSON=""

cleanup() {
  if [[ -n "$STAGING_DIR" && -d "$STAGING_DIR" ]]; then
    rm -rf "$STAGING_DIR"
  fi
  if [[ -n "$NOTARY_SUBMIT_JSON" && -f "$NOTARY_SUBMIT_JSON" ]]; then
    rm -f "$NOTARY_SUBMIT_JSON"
  fi
}

trap cleanup EXIT

# Gate the DMG on notary credentials, mirroring how native-promote.sh gates the
# updater feed on TAURI_SIGNING_PRIVATE_KEY. Without a notary profile we cannot
# notarize + staple the DMG, so skip cleanly (exit 0) and let the rest of the
# release proceed exactly as before. The DMG is notarized via the keychain
# profile that the local signed-release path uses (team 2R4WAH4R53).
if [[ -z "$NOTARY_PROFILE" ]]; then
  echo "Skipping DMG build (no notary keychain profile; set MACOS_NOTARY_PROFILE or NOTARY_PROFILE)."
  exit 0
fi

if [[ ! -f "$MANIFEST_PATH" ]]; then
  echo "Release manifest not found at $MANIFEST_PATH. Run 'npm run native:notarize' first." >&2
  exit 1
fi

# The release version is sourced from tauri.conf.json so the DMG slug and the
# promotion directory always agree with the bundle that was built.
VERSION="$(TAURI_CONF="$ROOT_DIR/src-tauri/tauri.conf.json" node -e '
const fs = require("node:fs");
const conf = JSON.parse(fs.readFileSync(process.env.TAURI_CONF, "utf8"));
process.stdout.write(conf.version || "");
')"

if [[ -z "$VERSION" ]]; then
  echo "Could not read version from src-tauri/tauri.conf.json." >&2
  exit 1
fi

# The notarized + stapled .app location and its notarization verdict come from
# the packaging manifest that native-notarize.sh annotated.
mapfile -t APP_INFO < <(MANIFEST_PATH="$MANIFEST_PATH" node <<'NODE'
const fs = require("node:fs");
const manifest = JSON.parse(fs.readFileSync(process.env.MANIFEST_PATH, "utf8"));
console.log(manifest.bundle?.path || "");
console.log(manifest.notarization?.status || "");
console.log(manifest.notarization?.stapleValidateStatus || "");
NODE
)

APP_PATH="${APP_INFO[0]}"
NOTARY_STATUS="${APP_INFO[1]}"
STAPLE_VALIDATE_STATUS="${APP_INFO[2]}"

if [[ -z "$APP_PATH" || ! -d "$APP_PATH" ]]; then
  echo "Cannot locate the notarized .app bundle from the manifest: '$APP_PATH'." >&2
  echo "Run 'npm run native:notarize' before building the DMG." >&2
  exit 1
fi

if [[ "$NOTARY_STATUS" != "Accepted" || "$STAPLE_VALIDATE_STATUS" != "passed" ]]; then
  echo "Bundle is not notarized + stapled (status='$NOTARY_STATUS', stapler='$STAPLE_VALIDATE_STATUS')." >&2
  echo "Run 'npm run native:notarize' before building the DMG." >&2
  exit 1
fi

# The DMG lands directly in the promotion directory that native-promote.sh
# created, so native-publish-release.sh uploads it with the rest of the release.
# Promote must run first.
PROMOTION_ROOT="$ROOT_DIR/artifacts/release/promoted/$CHANNEL/v$VERSION"
if [[ ! -d "$PROMOTION_ROOT" ]]; then
  echo "Promotion directory not found at $PROMOTION_ROOT." >&2
  echo "Run 'npm run native:promote' before building the DMG." >&2
  exit 1
fi

# Slug name (no spaces) keeps the published GitHub asset URL clean.
DMG_NAME="terminal-workspace-macos-v$VERSION.app.dmg"
DMG_PATH="$PROMOTION_ROOT/$DMG_NAME"

# 1. Stage the notarized + stapled .app plus an /Applications symlink so the DMG
#    opens with the familiar drag-to-Applications installer layout.
STAGING_DIR="$(mktemp -d "${TMPDIR:-/tmp}/termsnip-dmg.XXXXXX")"
ditto "$APP_PATH" "$STAGING_DIR/$(basename "$APP_PATH")"
ln -s /Applications "$STAGING_DIR/Applications"

# 2. Build a compressed (UDZO) disk image from the staging directory.
echo "Building DMG $DMG_NAME from $APP_PATH..."
hdiutil create \
  -volname "$VOLUME_NAME" \
  -srcfolder "$STAGING_DIR" \
  -ov \
  -format UDZO \
  "$DMG_PATH"

# 3. Notarize the DMG itself and wait for Apple's verdict.
echo "Submitting $DMG_NAME for notarization with profile $NOTARY_PROFILE..."
NOTARY_SUBMIT_JSON="$(mktemp "${TMPDIR:-/tmp}/termsnip-dmg-notary.XXXXXX.json")"
xcrun notarytool submit \
  "$DMG_PATH" \
  --keychain-profile "$NOTARY_PROFILE" \
  --wait \
  --output-format json >"$NOTARY_SUBMIT_JSON"

DMG_NOTARY_STATUS="$(NOTARY_SUBMIT_JSON="$NOTARY_SUBMIT_JSON" node <<'NODE'
const fs = require("node:fs");
const data = JSON.parse(fs.readFileSync(process.env.NOTARY_SUBMIT_JSON, "utf8"));
console.log(data.status || "Unknown");
NODE
)"

if [[ "$DMG_NOTARY_STATUS" != "Accepted" ]]; then
  echo "DMG notarization failed with status $DMG_NOTARY_STATUS." >&2
  exit 1
fi

# 4. Staple the notarization ticket to the DMG and verify it offline.
xcrun stapler staple "$DMG_PATH"
xcrun stapler validate "$DMG_PATH"

DMG_SHA256="$(shasum -a 256 "$DMG_PATH" | awk '{print $1}')"

echo
echo "DMG ready for publish:"
echo "  channel: $CHANNEL"
echo "  file: $DMG_PATH"
echo "  notarization: $DMG_NOTARY_STATUS"
echo "  sha256: $DMG_SHA256"
