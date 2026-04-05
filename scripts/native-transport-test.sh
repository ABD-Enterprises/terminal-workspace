#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cargo test --manifest-path "$ROOT_DIR/src-tauri/Cargo.toml" native_external_protocol_runtime_fixture_flow -- --test-threads=1
bash "$ROOT_DIR/scripts/native-fixture-preflight.sh" transport
cargo test --manifest-path "$ROOT_DIR/src-tauri/Cargo.toml" localhost_ssh_transport_fixture_flow -- --ignored --test-threads=1
