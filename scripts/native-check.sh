#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

bash "$ROOT_DIR/scripts/generate-tauri-icons.sh"
npm --prefix "$ROOT_DIR/apps/desktop" run build
cargo check --manifest-path "$ROOT_DIR/src-tauri/Cargo.toml"
