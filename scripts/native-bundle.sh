#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TAURI_CONFIG="$ROOT_DIR/src-tauri/tauri.conf.json"
PRODUCT_NAME="$(node -p "JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8')).productName" "$TAURI_CONFIG")"
APP_VERSION="$(node -p "JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8')).version" "$TAURI_CONFIG")"
APP_IDENTIFIER="$(node -p "JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8')).identifier" "$TAURI_CONFIG")"
APP_BINARY="terminal-workspace"
RELEASE_DIR="$ROOT_DIR/src-tauri/target/release"
BUNDLE_ROOT="$RELEASE_DIR/bundle/macos"
APP_PATH="$BUNDLE_ROOT/$PRODUCT_NAME.app"
MACOS_DIR="$APP_PATH/Contents/MacOS"
RESOURCES_DIR="$APP_PATH/Contents/Resources"
PLIST_PATH="$APP_PATH/Contents/Info.plist"
ICON_PATH="$ROOT_DIR/src-tauri/icons/icon.icns"
SIGNED_IDENTITY="${MACOS_SIGN_IDENTITY:-}"
SIGNING_TIMESTAMP_MODE="${MACOS_SIGN_TIMESTAMP_MODE:-none}"

find_developer_id() {
  security find-identity -v -p codesigning \
    | awk -F '"' '/Developer ID Application:/ { print $2; exit }'
}

if [[ -z "$SIGNED_IDENTITY" ]]; then
  SIGNED_IDENTITY="$(find_developer_id)"
fi

if [[ -z "$SIGNED_IDENTITY" ]]; then
  echo "No Developer ID Application signing identity found. Set MACOS_SIGN_IDENTITY to override." >&2
  exit 1
fi

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

cp "$RELEASE_DIR/$APP_BINARY" "$MACOS_DIR/$PRODUCT_NAME"
chmod +x "$MACOS_DIR/$PRODUCT_NAME"
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

echo "Signing app executable with: $SIGNED_IDENTITY"
codesign \
  --force \
  --options runtime \
  --timestamp="$SIGNING_TIMESTAMP_MODE" \
  --sign "$SIGNED_IDENTITY" \
  "$MACOS_DIR/$PRODUCT_NAME"

echo "Signing app bundle with: $SIGNED_IDENTITY"
codesign \
  --force \
  --options runtime \
  --timestamp="$SIGNING_TIMESTAMP_MODE" \
  --sign "$SIGNED_IDENTITY" \
  "$APP_PATH"

echo "Verifying signature..."
codesign --verify --deep --verbose=4 "$APP_PATH"
codesign --display --verbose=4 "$APP_PATH"
if ! spctl --assess --type execute --verbose=4 "$APP_PATH"; then
  echo "spctl assessment did not pass cleanly. This can still be acceptable for local testing on the build machine." >&2
fi

echo
echo "App bundle ready:"
echo "$APP_PATH"
