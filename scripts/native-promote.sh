#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT_DIR/scripts/load-env.sh"
MANIFEST_PATH="$ROOT_DIR/artifacts/release/latest-macos-release.json"
CHANNEL="${MACOS_RELEASE_CHANNEL:-stable}"

if [[ ! -f "$MANIFEST_PATH" ]]; then
  echo "Release manifest not found at $MANIFEST_PATH" >&2
  exit 1
fi

# Live re-verification of the signed bundle before promotion. The manifest
# values are checked downstream, but a manifest can be edited or stale; the
# only authoritative check is running codesign and spctl against the bundle
# we are actually about to ship. See parity-and-hardening-review §3.S-7.
APP_PATH_FROM_MANIFEST="$(MANIFEST_PATH="$MANIFEST_PATH" node -e '
const fs = require("node:fs");
const m = JSON.parse(fs.readFileSync(process.env.MANIFEST_PATH, "utf8"));
const path = m.bundle?.path;
if (!path) { process.exit(1); }
process.stdout.write(path);
' 2>/dev/null || true)"

if [[ -z "$APP_PATH_FROM_MANIFEST" || ! -d "$APP_PATH_FROM_MANIFEST" ]]; then
  echo "Cannot locate signed .app bundle from manifest for live re-verification: '$APP_PATH_FROM_MANIFEST'" >&2
  exit 1
fi

echo "Re-verifying signed bundle before promotion: $APP_PATH_FROM_MANIFEST"
if ! codesign --verify --deep --strict --verbose=2 "$APP_PATH_FROM_MANIFEST"; then
  echo "codesign --verify failed on the bundle about to be promoted. Refusing to promote." >&2
  exit 1
fi
if ! spctl -a -t exec -vv "$APP_PATH_FROM_MANIFEST"; then
  echo "spctl --assess failed on the bundle about to be promoted. Refusing to promote." >&2
  exit 1
fi
echo "Live re-verification passed."

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
RELEASE_NOTES_PATH="$PROMOTION_ROOT/RELEASE_NOTES.md"
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

# --- #86: updater feed (signed .app.tar.gz + latest.json) -------------------
# Runs only when the updater signing key is present. Without the secret this is
# a no-op, so releases behave exactly as before until the key is configured.
# The tarball is built from the NOTARIZED + STAPLED bundle re-verified above
# ($APP_PATH_FROM_MANIFEST) so updated installs stay notarized + Gatekeeper-OK.
# Both files land in $PROMOTION_ROOT, which native-publish-release.sh uploads
# wholesale — so they attach to the GitHub release with no publish-side change.
if [[ -n "${TAURI_SIGNING_PRIVATE_KEY:-}" ]]; then
  echo "Generating updater artifacts (signed tarball + latest.json)..."
  UPDATER_REPO="${GITHUB_REPOSITORY:-ABD-Enterprises/terminal-workspace}"
  UPDATER_TARBALL_NAME="$(basename "${ZIP_PATH%.zip}").app.tar.gz"
  UPDATER_TARBALL_PATH="$PROMOTION_ROOT/$UPDATER_TARBALL_NAME"
  APP_PARENT_DIR="$(dirname "$APP_PATH_FROM_MANIFEST")"
  APP_BUNDLE_NAME="$(basename "$APP_PATH_FROM_MANIFEST")"

  tar -C "$APP_PARENT_DIR" -czf "$UPDATER_TARBALL_PATH" "$APP_BUNDLE_NAME"

  # Sign the tarball with the updater key (minisign via the Tauri CLI, which
  # reads TAURI_SIGNING_PRIVATE_KEY / _PASSWORD from the env and writes
  # <tarball>.sig). npx fetches the pinned CLI on first use; cached after.
  npx --yes @tauri-apps/cli@^2 signer sign "$UPDATER_TARBALL_PATH"
  UPDATER_SIG_PATH="$UPDATER_TARBALL_PATH.sig"
  if [[ ! -f "$UPDATER_SIG_PATH" ]]; then
    echo "Updater signature was not produced at $UPDATER_SIG_PATH" >&2
    exit 1
  fi

  # darwin-aarch64 only: this ships an Apple-Silicon build (ARM64 runner,
  # non-universal cargo build). The download URL uses the tag-agnostic
  # releases/latest form so it always resolves to the newest stable release,
  # matching the tauri.conf.json updater endpoint.
  UPDATER_LATEST_JSON="$PROMOTION_ROOT/latest.json"
  UPDATER_DOWNLOAD_URL="https://github.com/$UPDATER_REPO/releases/latest/download/$UPDATER_TARBALL_NAME"
  VERSION="$VERSION" \
  UPDATER_SIG_PATH="$UPDATER_SIG_PATH" \
  UPDATER_DOWNLOAD_URL="$UPDATER_DOWNLOAD_URL" \
  UPDATER_PUB_DATE="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  UPDATER_LATEST_JSON="$UPDATER_LATEST_JSON" \
  node <<'NODE'
const fs = require("node:fs");
const signature = fs.readFileSync(process.env.UPDATER_SIG_PATH, "utf8").trim();
const feed = {
  version: process.env.VERSION,
  notes: `Update to version ${process.env.VERSION}. See the GitHub release page for full notes.`,
  pub_date: process.env.UPDATER_PUB_DATE,
  platforms: {
    "darwin-aarch64": {
      signature,
      url: process.env.UPDATER_DOWNLOAD_URL,
    },
  },
};
fs.writeFileSync(process.env.UPDATER_LATEST_JSON, `${JSON.stringify(feed, null, 2)}\n`);
NODE
  echo "  updater tarball: $UPDATER_TARBALL_PATH"
  echo "  updater latest.json: $UPDATER_LATEST_JSON"
else
  echo "Skipping updater artifacts (TAURI_SIGNING_PRIVATE_KEY not set)."
fi
# ---------------------------------------------------------------------------

ARCHIVE_BASENAME="$(basename "$ZIP_PATH")"
ARCHIVE_SHA256="$(shasum -a 256 "$ZIP_PATH" | awk '{print $1}')"
printf "%s  %s\n" "$ARCHIVE_SHA256" "$ARCHIVE_BASENAME" >"$CHECKSUM_PATH"

VERSION="$VERSION" CHANNEL="$CHANNEL" RELEASE_NOTES_PATH="$RELEASE_NOTES_PATH" VERSIONED_MANIFEST_PATH="$VERSIONED_MANIFEST_PATH" node <<'NODE'
const fs = require("node:fs");

const manifest = JSON.parse(fs.readFileSync(process.env.VERSIONED_MANIFEST_PATH, "utf8"));
const lines = [
  `# Terminal Workspace ${process.env.CHANNEL} release ${process.env.VERSION}`,
  "",
  `- Commit: ${manifest.commit ?? "unknown"}`,
  `- Bundle identifier: ${manifest.identifier}`,
  `- Notarization: ${manifest.notarization?.status ?? "unknown"}`,
  `- Stapler: ${manifest.notarization?.stapleValidateStatus ?? "unknown"}`,
  `- Gatekeeper: ${manifest.verification?.spctlStatus ?? "unknown"}`,
  "",
  "Assets in this promoted release directory were generated automatically from the notarized macOS bundle."
];

fs.writeFileSync(process.env.RELEASE_NOTES_PATH, `${lines.join("\n")}\n`);
NODE

PATCH_JSON="$PATCH_JSON" CHANNEL="$CHANNEL" PROMOTION_ROOT="$PROMOTION_ROOT" LATEST_PROMOTED_MANIFEST_PATH="$LATEST_PROMOTED_MANIFEST_PATH" CHECKSUM_PATH="$CHECKSUM_PATH" RELEASE_NOTES_PATH="$RELEASE_NOTES_PATH" PROMOTED_AT="$(date -Iseconds)" ROOT_DIR="$ROOT_DIR" node <<'NODE'
const fs = require("node:fs");
const path = require("node:path");

const patch = {
  promotion: {
    status: "promoted",
    channel: process.env.CHANNEL,
    promotedAt: process.env.PROMOTED_AT,
    directory: process.env.PROMOTION_ROOT,
    relativeDirectory: path.relative(process.env.ROOT_DIR, process.env.PROMOTION_ROOT),
    latestManifestPath: process.env.LATEST_PROMOTED_MANIFEST_PATH,
    latestManifestRelativePath: path.relative(process.env.ROOT_DIR, process.env.LATEST_PROMOTED_MANIFEST_PATH),
    checksumPath: process.env.CHECKSUM_PATH,
    checksumRelativePath: path.relative(process.env.ROOT_DIR, process.env.CHECKSUM_PATH),
    releaseNotesPath: process.env.RELEASE_NOTES_PATH,
    releaseNotesRelativePath: path.relative(process.env.ROOT_DIR, process.env.RELEASE_NOTES_PATH),
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
