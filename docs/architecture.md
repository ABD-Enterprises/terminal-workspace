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

## Module Map

The table below maps the frontend transport abstraction layer to its browser preview (Node) and native production (Rust/Tauri) counterparts:

| Layer / Subsystem | Path (Frontend) | Responsibility | Native Counterpart (`src-tauri/src`) | Browser Preview Counterpart (`apps/desktop/server`) |
| :--- | :--- | :--- | :--- | :--- |
| **API Boundary** | `apps/desktop/src/lib/api.ts` | High-level facade dispatching requests to native or browser preview backend | `src-tauri/src/main.rs` | `apps/desktop/server/backend.mjs` |
| **Transport Runtime** | `apps/desktop/src/lib/backend-runtime.ts` | Dispatches Tauri IPC commands vs HTTP/WebSocket calls based on runtime detection (`isTauriRuntime()`) | `src-tauri/src/main.rs` | `apps/desktop/server/backend-shell.mjs` |
| **Backend Contract** | `apps/desktop/src/lib/backend-contract.ts` | IPC payload schemas, command name constants, and request/response typing | `src-tauri/src/ipc_types.rs` | `apps/desktop/server/backend-buffers.mjs` |
| **Error Handling** | `apps/desktop/src/lib/backend-failure-messages.ts` | Typed error classification and user-facing messages | `src-tauri/src/ipc_error.rs` | `apps/desktop/server/backend-responses.mjs` |
| **SSH Transport** | `apps/desktop/src/lib/connections.ts` | SSH connection lifecycle, session parameters, and jump-host traversal | `src-tauri/src/native_transport.rs` | `apps/desktop/server/backend.mjs` |
| **Host Key Management** | `apps/desktop/src/lib/ensure-trusted-host-key.ts` | Known hosts matching, fingerprint validation, and TOFU trust prompts | `src-tauri/src/native_host_keys.rs` | `apps/desktop/server/backend-host-keys.mjs` |
| **SFTP Operations** | `apps/desktop/src/components/sftp/FileBrowser.tsx` | Remote filesystem browsing, directory listing, file transfers | `src-tauri/src/sftp.rs` | `apps/desktop/server/backend-sftp.mjs` |
| **Secrets & Keychain** | `apps/desktop/src/lib/runtime-secrets.ts` | In-memory session credentials and OS keychain persistence | `src-tauri/src/keychain_support.rs` | `apps/desktop/server/secrets.mjs` |
| **Test Fixtures & Conformance** | `tests/integration/` | Automated verification ensuring cross-backend behavior and protocol parity | `src-tauri/src/native_transport_conformance_tests.rs`, `src-tauri/src/native_transport_fixtures.rs` | `tests/integration/backend-auth.integration.test.ts` |
