# Architecture

Tauri shell plus a React + TypeScript + Tailwind workspace.

Today the browser and demo experience remain the safest review path, while the native shell owns the
shipping transport and persistence work:

- the React app owns routing, workspace state, and demo-mode behavior
- the Node backend is a browser-preview-only artifact for local web review; it is not part of the
  native ship
- the Tauri shell owns backend discovery, direct SSH and jump-host session lifecycle, native session
  stream I/O, native SFTP operations, native forwarding, native remote snippet execution, and
  Keychain-backed runtime secret persistence
- the Tauri shell also owns native key inspection, native key generation, native known-host scans,
  and SQLite-backed persistence through `tauri-plugin-sql`
- the native transport and secret-storage implementation are split out of `src-tauri/src/main.rs` into `src-tauri/src/native_transport.rs`, `src-tauri/src/keychain_support.rs`, and `src-tauri/src/native_transport_fixtures.rs`

The browser preview keeps the Node backend so web/demo review remains possible, but the native app
does not proxy JSON, binary, or websocket traffic through Node.
