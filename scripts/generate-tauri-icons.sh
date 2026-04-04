#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE_ICON="$ROOT_DIR/apps/desktop/public/favicon.svg"
TARGET_DIR="$ROOT_DIR/src-tauri/icons"
TMP_DIR="$(mktemp -d)"
ICONSET_DIR="$TMP_DIR/termsnip.iconset"

cleanup() {
  rm -rf "$TMP_DIR"
}

trap cleanup EXIT

if [[ ! -f "$SOURCE_ICON" ]]; then
  echo "Source icon not found: $SOURCE_ICON" >&2
  exit 1
fi

mkdir -p "$TARGET_DIR" "$ICONSET_DIR"

if ! qlmanage -t -s 1024 -o "$TMP_DIR" "$SOURCE_ICON" >/dev/null 2>&1; then
  if [[ -f "$TARGET_DIR/icon.icns" && -f "$TARGET_DIR/icon.png" ]]; then
    echo "Quick Look could not render icons in this shell; reusing existing generated icons." >&2
    exit 0
  fi

  echo "Quick Look failed to render a PNG from $SOURCE_ICON and no generated icons are available." >&2
  exit 1
fi

SOURCE_PNG="$TMP_DIR/$(basename "$SOURCE_ICON").png"
if [[ ! -f "$SOURCE_PNG" ]]; then
  echo "Quick Look failed to render a PNG from $SOURCE_ICON" >&2
  exit 1
fi

resize_icon() {
  local size="$1"
  local output_path="$2"
  sips -z "$size" "$size" "$SOURCE_PNG" --out "$output_path" >/dev/null
}

resize_icon 512 "$TARGET_DIR/icon.png"
resize_icon 32 "$TARGET_DIR/32x32.png"
resize_icon 128 "$TARGET_DIR/128x128.png"
resize_icon 256 "$TARGET_DIR/128x128@2x.png"

resize_icon 16 "$ICONSET_DIR/icon_16x16.png"
resize_icon 32 "$ICONSET_DIR/icon_16x16@2x.png"
resize_icon 32 "$ICONSET_DIR/icon_32x32.png"
resize_icon 64 "$ICONSET_DIR/icon_32x32@2x.png"
resize_icon 128 "$ICONSET_DIR/icon_128x128.png"
resize_icon 256 "$ICONSET_DIR/icon_128x128@2x.png"
resize_icon 256 "$ICONSET_DIR/icon_256x256.png"
resize_icon 512 "$ICONSET_DIR/icon_256x256@2x.png"
resize_icon 512 "$ICONSET_DIR/icon_512x512.png"
resize_icon 1024 "$ICONSET_DIR/icon_512x512@2x.png"

iconutil -c icns "$ICONSET_DIR" -o "$TARGET_DIR/icon.icns"
