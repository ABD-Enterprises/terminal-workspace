#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT_DIR/scripts/load-env.sh"
MANIFEST_PATH="$ROOT_DIR/artifacts/release/latest-macos-release.json"
NOTARY_PROFILE="${MACOS_NOTARY_PROFILE:-${NOTARY_PROFILE:-}}"
NOTARY_KEY_ID="${MACOS_NOTARY_KEY_ID:-${NOTARY_KEY_ID:-}}"
NOTARY_ISSUER="${MACOS_NOTARY_ISSUER:-${NOTARY_ISSUER:-}}"
NOTARY_KEY_PATH="${MACOS_NOTARY_KEY_PATH:-${NOTARY_KEY_PATH:-}}"
NOTARY_KEY_CONTENT="${MACOS_NOTARY_KEY_CONTENT:-${NOTARY_KEY_CONTENT:-}}"
NOTARY_KEY_BASE64="${MACOS_NOTARY_KEY_BASE64:-${MACOS_NOTARY_KEY_B64:-${NOTARY_KEY_BASE64:-}}}"
NOTARY_APPLE_ID="${MACOS_NOTARY_APPLE_ID:-${APPLE_ID:-}}"
NOTARY_APP_PASSWORD="${MACOS_NOTARY_APP_PASSWORD:-${APPLE_APP_PASSWORD:-}}"
NOTARY_TEAM_ID="${MACOS_NOTARY_TEAM_ID:-${APPLE_TEAM_ID:-${TEAM_ID:-}}}"
REBUILD_RELEASE="${NATIVE_RELEASE_REBUILD:-1}"
NOTARY_DRY_RUN="${MACOS_NOTARY_DRY_RUN:-0}"
NOTARY_AUTH_MODE=""
NOTARY_KEY_SOURCE=""
TEMP_KEY_PATH=""

cleanup() {
  if [[ -n "$TEMP_KEY_PATH" && -f "$TEMP_KEY_PATH" ]]; then
    rm -f "$TEMP_KEY_PATH"
  fi
}

trap cleanup EXIT

decode_base64_to_file() {
  local encoded_value="$1"
  local destination_path="$2"

  ENCODED_VALUE="$encoded_value" DESTINATION_PATH="$destination_path" python3 <<'PY'
import base64
import os
from pathlib import Path

destination = Path(os.environ["DESTINATION_PATH"])
destination.write_bytes(base64.b64decode(os.environ["ENCODED_VALUE"]))
PY
}

build_notary_auth_args() {
  local -n auth_args_ref=$1

  if [[ -z "$NOTARY_KEY_PATH" && -n "$NOTARY_KEY_CONTENT" ]]; then
    TEMP_KEY_PATH="$(mktemp "${TMPDIR:-/tmp}/termsnip-notary-key.XXXXXX.p8")"
    printf '%s' "$NOTARY_KEY_CONTENT" >"$TEMP_KEY_PATH"
    NOTARY_KEY_PATH="$TEMP_KEY_PATH"
    NOTARY_KEY_SOURCE="content"
  fi

  if [[ -z "$NOTARY_KEY_PATH" && -n "$NOTARY_KEY_BASE64" ]]; then
    TEMP_KEY_PATH="$(mktemp "${TMPDIR:-/tmp}/termsnip-notary-key.XXXXXX.p8")"
    decode_base64_to_file "$NOTARY_KEY_BASE64" "$TEMP_KEY_PATH"
    NOTARY_KEY_PATH="$TEMP_KEY_PATH"
    NOTARY_KEY_SOURCE="base64"
  fi

  if [[ -n "$NOTARY_KEY_PATH" && -n "$NOTARY_KEY_ID" && -n "$NOTARY_ISSUER" ]]; then
    NOTARY_AUTH_MODE="app-store-connect-key"
    if [[ -z "$NOTARY_KEY_SOURCE" ]]; then
      NOTARY_KEY_SOURCE="path"
    fi
    auth_args_ref=(--key "$NOTARY_KEY_PATH" --key-id "$NOTARY_KEY_ID" --issuer "$NOTARY_ISSUER")
    return
  fi

  if [[ -n "$NOTARY_APPLE_ID" && -n "$NOTARY_APP_PASSWORD" && -n "$NOTARY_TEAM_ID" ]]; then
    NOTARY_AUTH_MODE="apple-id"
    auth_args_ref=(--apple-id "$NOTARY_APPLE_ID" --password "$NOTARY_APP_PASSWORD" --team-id "$NOTARY_TEAM_ID")
    return
  fi

  if [[ -n "$NOTARY_PROFILE" ]]; then
    NOTARY_AUTH_MODE="keychain-profile"
    auth_args_ref=(--keychain-profile "$NOTARY_PROFILE")
    return
  fi

  echo "Provide MACOS_NOTARY_PROFILE, App Store Connect key credentials, or Apple ID notarization credentials." >&2
  exit 1
}

declare -a NOTARY_AUTH_ARGS=()
build_notary_auth_args NOTARY_AUTH_ARGS

if [[ "$NOTARY_DRY_RUN" == "1" ]]; then
  echo "mode=$NOTARY_AUTH_MODE"
  echo "profile=${NOTARY_PROFILE:-}"
  echo "key_id=${NOTARY_KEY_ID:-}"
  echo "issuer=${NOTARY_ISSUER:-}"
  echo "key_source=${NOTARY_KEY_SOURCE:-}"
  echo "apple_id=${NOTARY_APPLE_ID:-}"
  echo "team_id=${NOTARY_TEAM_ID:-}"
  exit 0
fi

if [[ "$REBUILD_RELEASE" == "1" ]]; then
  bash "$ROOT_DIR/scripts/native-release-check.sh"
fi

if [[ ! -f "$MANIFEST_PATH" ]]; then
  echo "Release manifest not found at $MANIFEST_PATH" >&2
  exit 1
fi

mapfile -t RELEASE_INFO < <(MANIFEST_PATH="$MANIFEST_PATH" node <<'NODE'
const fs = require("node:fs");
const manifest = JSON.parse(fs.readFileSync(process.env.MANIFEST_PATH, "utf8"));
console.log(manifest.archive.path);
console.log(manifest.bundle.path);
console.log(manifest.manifest?.path || process.env.MANIFEST_PATH);
console.log(manifest.manifest?.latestPath || process.env.MANIFEST_PATH);
console.log(manifest.version);
NODE
)

ZIP_PATH="${RELEASE_INFO[0]}"
APP_PATH="${RELEASE_INFO[1]}"
VERSIONED_MANIFEST_PATH="${RELEASE_INFO[2]}"
LATEST_MANIFEST_PATH="${RELEASE_INFO[3]}"
APP_VERSION="${RELEASE_INFO[4]}"
ARTIFACT_ROOT="$(dirname "$ZIP_PATH")"
ARTIFACT_STEM="$(basename "$ZIP_PATH" .zip)"
NOTARY_SUBMIT_JSON="$ARTIFACT_ROOT/${ARTIFACT_STEM}.notary-submit.json"
NOTARY_LOG_JSON="$ARTIFACT_ROOT/${ARTIFACT_STEM}.notary-log.json"
STAPLER_LOG="$ARTIFACT_ROOT/${ARTIFACT_STEM}.stapler-staple.txt"
STAPLER_VALIDATE_LOG="$ARTIFACT_ROOT/${ARTIFACT_STEM}.stapler-validate.txt"
POST_NOTARY_SPCTL_LOG="$ARTIFACT_ROOT/${ARTIFACT_STEM}.post-notary.spctl.txt"
PATCH_JSON="$ARTIFACT_ROOT/${ARTIFACT_STEM}.notarization-patch.json"

rm -f "$NOTARY_SUBMIT_JSON" "$NOTARY_LOG_JSON" "$STAPLER_LOG" "$STAPLER_VALIDATE_LOG" "$POST_NOTARY_SPCTL_LOG" "$PATCH_JSON"

if [[ "$NOTARY_AUTH_MODE" == "keychain-profile" ]]; then
  echo "Submitting $ZIP_PATH for notarization with profile $NOTARY_PROFILE..."
else
  echo "Submitting $ZIP_PATH for notarization with $NOTARY_AUTH_MODE credentials..."
fi
xcrun notarytool submit \
  "$ZIP_PATH" \
  "${NOTARY_AUTH_ARGS[@]}" \
  --wait \
  --output-format json >"$NOTARY_SUBMIT_JSON"

SUBMISSION_ID="$(NOTARY_SUBMIT_JSON="$NOTARY_SUBMIT_JSON" node <<'NODE'
const fs = require("node:fs");
const data = JSON.parse(fs.readFileSync(process.env.NOTARY_SUBMIT_JSON, "utf8"));
console.log(data.id || "");
NODE
)"

NOTARY_STATUS="$(NOTARY_SUBMIT_JSON="$NOTARY_SUBMIT_JSON" node <<'NODE'
const fs = require("node:fs");
const data = JSON.parse(fs.readFileSync(process.env.NOTARY_SUBMIT_JSON, "utf8"));
console.log(data.status || "Unknown");
NODE
)"

if [[ -n "$SUBMISSION_ID" ]]; then
  xcrun notarytool log \
    "$SUBMISSION_ID" \
    "$NOTARY_LOG_JSON" \
    "${NOTARY_AUTH_ARGS[@]}" >/dev/null
fi

STAPLE_STATUS="skipped"
STAPLE_VALIDATE_STATUS="skipped"
POST_NOTARY_SPCTL_STATUS="skipped"
ZIP_SHA256="$(shasum -a 256 "$ZIP_PATH" | awk '{print $1}')"
ZIP_BYTES="$(stat -f%z "$ZIP_PATH")"
NOTARIZED_AT=""

if [[ "$NOTARY_STATUS" == "Accepted" ]]; then
  xcrun stapler staple -v "$APP_PATH" >"$STAPLER_LOG" 2>&1
  STAPLE_STATUS="passed"

  if xcrun stapler validate -v "$APP_PATH" >"$STAPLER_VALIDATE_LOG" 2>&1; then
    STAPLE_VALIDATE_STATUS="passed"
  else
    STAPLE_VALIDATE_STATUS="failed"
    cat "$STAPLER_VALIDATE_LOG" >&2
    exit 1
  fi

  ditto -c -k --sequesterRsrc --keepParent "$APP_PATH" "$ZIP_PATH"
  ZIP_SHA256="$(shasum -a 256 "$ZIP_PATH" | awk '{print $1}')"
  ZIP_BYTES="$(stat -f%z "$ZIP_PATH")"

  if spctl --assess --type execute --verbose=4 "$APP_PATH" >"$POST_NOTARY_SPCTL_LOG" 2>&1; then
    POST_NOTARY_SPCTL_STATUS="accepted"
  else
    POST_NOTARY_SPCTL_STATUS="not_accepted"
  fi

  NOTARIZED_AT="$(date -Iseconds)"
else
  echo "Notarization status: $NOTARY_STATUS" >&2
fi

PATCH_JSON="$PATCH_JSON" \
NOTARY_PROFILE="$NOTARY_PROFILE" \
NOTARY_AUTH_MODE="$NOTARY_AUTH_MODE" \
NOTARY_KEY_ID="$NOTARY_KEY_ID" \
NOTARY_ISSUER="$NOTARY_ISSUER" \
NOTARY_KEY_SOURCE="$NOTARY_KEY_SOURCE" \
NOTARY_APPLE_ID="$NOTARY_APPLE_ID" \
NOTARY_TEAM_ID="$NOTARY_TEAM_ID" \
SUBMISSION_ID="$SUBMISSION_ID" \
NOTARY_STATUS="$NOTARY_STATUS" \
NOTARY_SUBMIT_JSON="$NOTARY_SUBMIT_JSON" \
NOTARY_LOG_JSON="$NOTARY_LOG_JSON" \
STAPLER_LOG="$STAPLER_LOG" \
STAPLER_VALIDATE_LOG="$STAPLER_VALIDATE_LOG" \
POST_NOTARY_SPCTL_LOG="$POST_NOTARY_SPCTL_LOG" \
STAPLE_STATUS="$STAPLE_STATUS" \
STAPLE_VALIDATE_STATUS="$STAPLE_VALIDATE_STATUS" \
POST_NOTARY_SPCTL_STATUS="$POST_NOTARY_SPCTL_STATUS" \
ZIP_PATH="$ZIP_PATH" \
ZIP_SHA256="$ZIP_SHA256" \
ZIP_BYTES="$ZIP_BYTES" \
NOTARIZED_AT="$NOTARIZED_AT" node <<'NODE'
const fs = require("node:fs");

const readText = (filePath) => {
  if (!filePath || !fs.existsSync(filePath)) {
    return "";
  }

  return fs.readFileSync(filePath, "utf8").trim();
};

const patch = {
  archive: {
    path: process.env.ZIP_PATH,
    exists: true,
    sha256: process.env.ZIP_SHA256,
    bytes: Number(process.env.ZIP_BYTES || "0"),
  },
  verification: {
    spctlStatus: process.env.POST_NOTARY_SPCTL_STATUS || "unknown",
    spctlLog: process.env.POST_NOTARY_SPCTL_LOG || null,
  },
  diagnostics: {
    spctl: readText(process.env.POST_NOTARY_SPCTL_LOG),
  },
  notarization: {
    profile: process.env.NOTARY_PROFILE || null,
    authentication: process.env.NOTARY_AUTH_MODE || "unknown",
    authenticationDetails: {
      profile: process.env.NOTARY_PROFILE || null,
      keyId: process.env.NOTARY_KEY_ID || null,
      issuer: process.env.NOTARY_ISSUER || null,
      keySource: process.env.NOTARY_KEY_SOURCE || null,
      appleId: process.env.NOTARY_APPLE_ID || null,
      teamId: process.env.NOTARY_TEAM_ID || null,
    },
    submissionId: process.env.SUBMISSION_ID || null,
    status: process.env.NOTARY_STATUS || "Unknown",
    submitLog: process.env.NOTARY_SUBMIT_JSON || null,
    notaryLog: process.env.NOTARY_LOG_JSON || null,
    stapleLog: process.env.STAPLER_LOG || null,
    stapleStatus: process.env.STAPLE_STATUS || "skipped",
    stapleValidateLog: process.env.STAPLER_VALIDATE_LOG || null,
    stapleValidateStatus: process.env.STAPLE_VALIDATE_STATUS || "skipped",
    postSpctlLog: process.env.POST_NOTARY_SPCTL_LOG || null,
    postSpctlStatus: process.env.POST_NOTARY_SPCTL_STATUS || "unknown",
    notarizedAt: process.env.NOTARIZED_AT || null,
  },
};

fs.writeFileSync(process.env.PATCH_JSON, `${JSON.stringify(patch, null, 2)}\n`);
NODE

node "$ROOT_DIR/scripts/native-release-annotate.mjs" "$VERSIONED_MANIFEST_PATH" "$PATCH_JSON"
if [[ "$LATEST_MANIFEST_PATH" != "$VERSIONED_MANIFEST_PATH" ]]; then
  cp "$VERSIONED_MANIFEST_PATH" "$LATEST_MANIFEST_PATH"
fi

if [[ "$NOTARY_STATUS" != "Accepted" ]]; then
  echo "Notarization failed with status $NOTARY_STATUS" >&2
  exit 1
fi

echo
echo "Notarization complete:"
echo "  submission: $SUBMISSION_ID"
echo "  status: $NOTARY_STATUS"
echo "  stapler: $STAPLE_VALIDATE_STATUS"
echo "  spctl: $POST_NOTARY_SPCTL_STATUS"
echo "  manifest: $VERSIONED_MANIFEST_PATH"
