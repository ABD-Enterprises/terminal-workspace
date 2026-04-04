#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TAURI_CONFIG="$ROOT_DIR/src-tauri/tauri.conf.json"
PRODUCT_NAME="${MACOS_PRODUCT_NAME:-$(node -p "JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8')).productName" "$TAURI_CONFIG")}"
APP_VERSION="${MACOS_APP_VERSION:-$(node -p "JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8')).version" "$TAURI_CONFIG")}"
APP_IDENTIFIER="${MACOS_APP_IDENTIFIER:-$(node -p "JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8')).identifier" "$TAURI_CONFIG")}"
APP_BINARY="terminal-workspace"
APP_SLUG="terminal-workspace"
RELEASE_DIR="$ROOT_DIR/src-tauri/target/release"
BUNDLE_ROOT="$RELEASE_DIR/bundle/macos"
APP_PATH="$BUNDLE_ROOT/$PRODUCT_NAME.app"
MACOS_DIR="$APP_PATH/Contents/MacOS"
RESOURCES_DIR="$APP_PATH/Contents/Resources"
PLIST_PATH="$APP_PATH/Contents/Info.plist"
ICON_PATH="$ROOT_DIR/src-tauri/icons/icon.icns"
ARTIFACT_ROOT="$ROOT_DIR/artifacts/release"
ARTIFACT_STEM="${APP_SLUG}-macos-v${APP_VERSION}"
ZIP_PATH="$ARTIFACT_ROOT/${ARTIFACT_STEM}.zip"
MANIFEST_PATH="$ARTIFACT_ROOT/${ARTIFACT_STEM}.json"
LATEST_MANIFEST_PATH="$ARTIFACT_ROOT/latest-macos-release.json"
CODESIGN_VERIFY_LOG="$ARTIFACT_ROOT/${ARTIFACT_STEM}.codesign-verify.txt"
CODESIGN_DISPLAY_LOG="$ARTIFACT_ROOT/${ARTIFACT_STEM}.codesign-display.txt"
SPCTL_LOG="$ARTIFACT_ROOT/${ARTIFACT_STEM}.spctl.txt"
SIGN_MODE="${MACOS_SIGN_MODE:-auto}"
SIGNED_IDENTITY="${MACOS_SIGN_IDENTITY:-}"
SIGNING_TIMESTAMP_MODE="${MACOS_SIGN_TIMESTAMP_MODE:-none}"
BUILD_TIME="$(date +"%Y-%m-%dT%H:%M:%S%z")"
BUILD_BRANCH="$(git -C "$ROOT_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
BUILD_COMMIT="$(git -C "$ROOT_DIR" rev-parse HEAD 2>/dev/null || true)"
EXECUTABLE_PATH="$MACOS_DIR/$PRODUCT_NAME"

find_developer_id() {
  security find-identity -v -p codesigning \
    | awk -F '"' '/Developer ID Application:/ { print $2; exit }'
}

case "$SIGN_MODE" in
  auto|require|skip)
    ;;
  *)
    echo "Unsupported MACOS_SIGN_MODE: $SIGN_MODE" >&2
    exit 1
    ;;
esac

if [[ "$SIGN_MODE" != "skip" && -z "$SIGNED_IDENTITY" ]]; then
  SIGNED_IDENTITY="$(find_developer_id)"
fi

if [[ "$SIGN_MODE" == "require" && -z "$SIGNED_IDENTITY" ]]; then
  echo "No Developer ID Application signing identity found. Set MACOS_SIGN_IDENTITY to override." >&2
  exit 1
fi

SIGNING_PERFORMED=false
if [[ "$SIGN_MODE" == "skip" ]]; then
  SIGNED_IDENTITY=""
elif [[ -n "$SIGNED_IDENTITY" ]]; then
  SIGNING_PERFORMED=true
fi

mkdir -p "$ARTIFACT_ROOT"
rm -f "$ZIP_PATH" "$MANIFEST_PATH" "$LATEST_MANIFEST_PATH" "$CODESIGN_VERIFY_LOG" "$CODESIGN_DISPLAY_LOG" "$SPCTL_LOG"

echo "Building frontend bundle..."
npm --prefix "$ROOT_DIR/apps/desktop" run build

echo "Generating native icons..."
bash "$ROOT_DIR/scripts/generate-tauri-icons.sh"

echo "Building release binary..."
cargo build --release --manifest-path "$ROOT_DIR/src-tauri/Cargo.toml"

if [[ ! -f "$RELEASE_DIR/$APP_BINARY" ]]; then
  echo "Release binary not found at $RELEASE_DIR/$APP_BINARY" >&2
  exit 1
fi

rm -rf "$APP_PATH"
mkdir -p "$MACOS_DIR" "$RESOURCES_DIR"

cp "$RELEASE_DIR/$APP_BINARY" "$EXECUTABLE_PATH"
chmod +x "$EXECUTABLE_PATH"
cp "$ICON_PATH" "$RESOURCES_DIR/icon.icns"

cat >"$PLIST_PATH" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>en</string>
  <key>CFBundleDisplayName</key>
  <string>${PRODUCT_NAME}</string>
  <key>CFBundleExecutable</key>
  <string>${PRODUCT_NAME}</string>
  <key>CFBundleIconFile</key>
  <string>icon</string>
  <key>CFBundleIdentifier</key>
  <string>${APP_IDENTIFIER}</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>${PRODUCT_NAME}</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>${APP_VERSION}</string>
  <key>CFBundleVersion</key>
  <string>${APP_VERSION}</string>
  <key>LSApplicationCategoryType</key>
  <string>public.app-category.developer-tools</string>
  <key>LSMinimumSystemVersion</key>
  <string>13.0</string>
  <key>NSHighResolutionCapable</key>
  <true/>
</dict>
</plist>
PLIST

CODESIGN_STATUS="skipped"
SPCTL_STATUS="skipped"
echo "codesign skipped" >"$CODESIGN_VERIFY_LOG"
echo "codesign display skipped" >"$CODESIGN_DISPLAY_LOG"
echo "spctl skipped" >"$SPCTL_LOG"

if [[ "$SIGNING_PERFORMED" == "true" ]]; then
  echo "Signing app executable with: $SIGNED_IDENTITY"
  codesign \
    --force \
    --options runtime \
    --timestamp="$SIGNING_TIMESTAMP_MODE" \
    --sign "$SIGNED_IDENTITY" \
    "$EXECUTABLE_PATH"

  echo "Signing app bundle with: $SIGNED_IDENTITY"
  codesign \
    --force \
    --options runtime \
    --timestamp="$SIGNING_TIMESTAMP_MODE" \
    --sign "$SIGNED_IDENTITY" \
    "$APP_PATH"

  if codesign --verify --deep --strict --verbose=4 "$APP_PATH" >"$CODESIGN_VERIFY_LOG" 2>&1; then
    CODESIGN_STATUS="passed"
  else
    CODESIGN_STATUS="failed"
    cat "$CODESIGN_VERIFY_LOG" >&2
    exit 1
  fi

  codesign --display --verbose=4 "$APP_PATH" >"$CODESIGN_DISPLAY_LOG" 2>&1 || true

  if spctl --assess --type execute --verbose=4 "$APP_PATH" >"$SPCTL_LOG" 2>&1; then
    SPCTL_STATUS="accepted"
  else
    SPCTL_STATUS="not_accepted"
  fi
else
  echo "Signing skipped (mode: $SIGN_MODE)"
fi

echo "Creating release archive..."
ditto -c -k --sequesterRsrc --keepParent "$APP_PATH" "$ZIP_PATH"

EXECUTABLE_SHA256="$(shasum -a 256 "$EXECUTABLE_PATH" | awk '{print $1}')"
ZIP_SHA256="$(shasum -a 256 "$ZIP_PATH" | awk '{print $1}')"

export RELEASE_MANIFEST_PATH="$MANIFEST_PATH"
export PRODUCT_NAME APP_VERSION APP_IDENTIFIER APP_PATH ZIP_PATH EXECUTABLE_PATH
export BUILD_TIME BUILD_BRANCH BUILD_COMMIT
export SIGN_MODE SIGNED_IDENTITY SIGNING_PERFORMED SIGNING_TIMESTAMP_MODE
export CODESIGN_STATUS SPCTL_STATUS CODESIGN_VERIFY_LOG CODESIGN_DISPLAY_LOG SPCTL_LOG
export EXECUTABLE_SHA256 ZIP_SHA256

node "$ROOT_DIR/scripts/native-release-manifest.mjs"
cp "$MANIFEST_PATH" "$LATEST_MANIFEST_PATH"

echo
echo "Native macOS bundle ready:"
echo "  app: $APP_PATH"
echo "  zip: $ZIP_PATH"
echo "  manifest: $MANIFEST_PATH"
echo "  signing mode: $SIGN_MODE"
if [[ -n "$SIGNED_IDENTITY" ]]; then
  echo "  signing identity: $SIGNED_IDENTITY"
fi
echo "  codesign status: $CODESIGN_STATUS"
echo "  spctl status: $SPCTL_STATUS"
