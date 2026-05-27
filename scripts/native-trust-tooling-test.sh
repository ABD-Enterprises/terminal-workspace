#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

bash "$ROOT_DIR/scripts/native-fixture-preflight.sh" trust
if command -v cargo >/dev/null 2>&1; then
  cargo test --manifest-path "$ROOT_DIR/src-tauri/Cargo.toml" native_trust_tooling_fixture_flow -- --test-threads=1
else
  echo "cargo command not found, skipping rust native trust tooling tests"
fi
