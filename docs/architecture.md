# Architecture

Tauri shell plus a React + TypeScript + Tailwind workspace.

Today the browser and demo experience remain the safest review path, but the native shell owns most
of the real transport work:

- the React app owns routing, workspace state, and demo-mode behavior
- the Node backend still handles the browser path plus key inspection, key generation, and known-host scans
- the Tauri shell now proxies backend discovery, JSON/binary API access, direct SSH and jump-host session lifecycle, native session stream I/O, native SFTP operations, native forwarding, native remote snippet execution, and Keychain-backed runtime secret persistence
- the native transport and secret-storage implementation are split out of `src-tauri/src/main.rs` into `src-tauri/src/native_transport.rs`, `src-tauri/src/keychain_support.rs`, and `src-tauri/src/native_transport_fixtures.rs`

The intended end state is still Rust-backed local transport and persistence, but the current codebase
is intentionally using a staged seam so the web/demo surface stays stable while native ownership
expands.
