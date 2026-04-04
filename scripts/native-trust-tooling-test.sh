#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cargo test --manifest-path "$ROOT_DIR/src-tauri/Cargo.toml" native_trust_tooling_fixture_flow -- --test-threads=1
