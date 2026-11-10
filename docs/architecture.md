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
  and SQLite-backed persistence. `tauri-plugin-sql` creates and migrates the database at startup;
  the renderer reaches it only through the typed `terminal_workspace_persistence_*` commands in
  `src-tauri/src/persistence.rs`, which own the tables and every SQL statement, and holds no
  `sql:` permission (#472)
- the native transport and secret-storage implementation are split out of `src-tauri/src/main.rs` into `src-tauri/src/native_transport.rs`, `src-tauri/src/keychain_support.rs`, and `src-tauri/src/native_transport_fixtures.rs`

The browser preview keeps the Node backend so web/demo review remains possible, but the native app
does not proxy JSON, binary, or websocket traffic through Node.

## Module Map

The table below maps each frontend transport module to the module that does the same job in the native app (Rust/Tauri) and in the browser preview (Node). Paths for the native column are under `src-tauri/src`, and paths for the browser column are under `apps/desktop/server`. The browser preview serves its routes and WebSocket from `backend.mjs`; the other `.mjs` files are helpers it imports.

| Layer / Subsystem | Frontend (`apps/desktop/src`) | Responsibility | Native counterpart | Browser preview counterpart |
| :--- | :--- | :--- | :--- | :--- |
| **API Boundary** | `lib/api.ts` | Exposes one function per backend operation and picks the demo, native (Tauri IPC) or browser-preview (HTTP `fetch`) implementation | `main.rs` (the `#[tauri::command]` handlers registered in `generate_handler!`), `sftp.rs` | `backend.mjs` (HTTP routes under `/api/backend/`) |
| **Transport Runtime** | `lib/backend-runtime.ts` | Detects the Tauri runtime (`isTauriRuntime()`), wraps `invokeTauriCommand`, and opens, parses and closes the session stream or WebSocket | `main.rs` (transport info and session-stream commands) | `backend.mjs` (WebSocket upgrade for `/ws/sessions/<id>`) |
| **Backend Contract** | `lib/backend-contract.ts`, `lib/tauri-commands.ts` | Request, response and failure types shared by both backends, and the table of Tauri command names with their request and response types | `ipc_types.rs` | `backend.mjs` (plain JSON; there is no separate schema file) |
| **Error Handling** | `lib/backend-failure-messages.ts` | Turns typed backend failures into user-facing messages (error classification by code is in `lib/ssh-error-classifier.ts`) | `ipc_error.rs` (typed error with a stable code) | `backend-responses.mjs` (JSON and error response helpers) |
| **Connection Payload** | `lib/connections.ts` | Builds the connection payload for a host: resolved identity, trusted host key and the jump-host chain (rejects cycles) | `native_transport.rs` (SSH sessions, key handling, transport loops) | `backend.mjs` |
| **Host Key Management** | `lib/ensure-trusted-host-key.ts` | First-connect fingerprint prompt: scans the host key, asks the user to trust it and stores the choice | `native_host_keys.rs` (durable trust-on-first-use store) | `backend-host-keys.mjs` (same `known_hosts` format) |
| **SFTP Operations** | `components/sftp/FileBrowser.tsx` | Remote file browser UI (listing, rename, delete, upload, download) that calls the SFTP functions in `lib/api.ts` | `sftp.rs` | `backend-sftp.mjs` (deadline-bounded SFTP helper); routes are in `backend.mjs` |
| **Secrets** | `lib/runtime-secrets.ts`, `lib/native-secrets.ts` | Decides which passwords and passphrases a connection needs, prompts for them, and reads or stores them through the native keychain commands | `keychain_support.rs` (macOS Keychain through the `security` tool) | `secrets.mjs` (zero-fills its in-memory copies; no keychain) |
| **Conformance Tests** | `tests/integration/security-helper-conformance.integration.test.ts` | Runs the same cases from `tests/fixtures/security-helper-conformance.json` against both backends' path, glob and shell-quoting helpers | `native_transport_conformance_tests.rs` | `backend-shell.mjs`, `backend-paths.mjs`, `backend-glob.mjs` (the helpers under test) |

## Host key trust: two stores, one rule (#489)

There are two records of which host keys to trust, and they are allowed to disagree.

- **Approved keys.** When the user scans a host and approves a key, the renderer keeps it in its
  known-hosts inventory (`useKnownHostsStore`). Native inventory is persisted in SQLite through the
  persistence commands, with a localStorage fallback; the browser preview keeps it in localStorage.
  `buildBackendConnection` (`apps/desktop/src/lib/connections.ts`) looks up each host's approved
  key and passes it as `knownHostPublicKey` and `knownHostAlgorithm`, jump hops included, when
  given the whole inventory. SFTP, snippets and session restore pass the whole inventory; an
  interactive terminal session passes the target's approval only.
- **Pins.** A durable `known_hosts`-style file under the app data directory
  (`src-tauri/src/native_host_keys.rs`; the browser backend resolves the same path in
  `backend-host-keys.mjs`), written on first use for hosts with no approved key.

**The rule.** For each connection, in this order:

1. A refused algorithm (`ssh-dss`, #475) is refused, whatever the approval or pin says.
2. If the connection carries an approved key, that key decides alone: a match connects without
   reading or writing the pin store, and a difference fails with no fallback to the pin.
3. Otherwise, if the host's policy is `requireTrusted`, the connection is refused.
4. Otherwise the pin store decides: an unknown host is pinned, a match connects, and a difference
   fails with a host-key-mismatch error before credentials are sent.

So the stores can hold different keys for a host without harm. An approved key always wins over a
stale pin, so re-approving a rebuilt host recovers it, as long as the approved key is the one the
server actually presents. A scan can list several key types, and the direct native and browser
handshakes do not limit negotiation to the approved type: approving the RSA key of a server that
negotiates Ed25519 still fails with a mismatch, and only approving the negotiated key fixes it. If an
approval is later removed while an old pin remains, an `allowUnknown` host gets the mismatch error
and a `requireTrusted` host is refused as untrusted; either way, re-scanning and approving resolves
it. Nothing merges the two stores, and nothing needs to.

**Where it applies.** The direct native SSH path (`decide_native_host_key` in `main.rs`) and the
browser backend (`selectHostKeyVerifier` in `backend-host-keys.mjs`, called by
`createConnectConfig`) follow it exactly. Connections made by the external `ssh` client follow the same shape through
OpenSSH: a hop with an approved key gets a per-session known-hosts file holding the approved keys of the
connection's hops and `StrictHostKeyChecking yes`; a hop without one uses the durable pin file with
`StrictHostKeyChecking accept-new`. Mosh without an approved key leaves `UserKnownHostsFile`
unspecified, so OpenSSH's own defaults apply there.

Tests that pin this: `decide_native_host_key` precedence tests in `src-tauri/src/main.rs`, the
`selectHostKeyVerifier` cases in `tests/integration/backend-host-keys.integration.test.ts`, the
approved-key cases in `apps/desktop/src/lib/connections.test.ts`, and the jump-hop restore case in
`apps/desktop/src/components/terminal/SessionRestoreManager.test.tsx`.

## Native Backend Structure and Refactoring Targets (`main.rs`) (#487)

While `src-tauri/src/main.rs` is large (~6,900 lines), over one third of the file (~2,400 lines) is test code (`native_transport_conformance_tests`, `native_transport_fixtures`, inline test modules).

Of the remaining production code:
- **Tauri IPC Command Handlers**: 38 registered handlers across 637 body lines (~14% of production code). Only two handlers exceed 30 lines.
- **Session Lifecycle & Transport**: 157 helper functions (~3,900 lines, ~86% of production code) manage transport loops, session lifecycle, host key negotiation, and menu/status building.

Future refactoring should target transport and session lifecycle boundaries rather than splitting by IPC command:
- Session loops (`run_jump_host_session_loop`, `run_external_command_session_loop`, `run_native_session_loop`) belong in a transport session runtime module.
- Host key negotiation and blocking operations belong in dedicated transport/config modules (following the precedent set by `src-tauri/src/sftp.rs` and `src-tauri/src/persistence.rs`).
