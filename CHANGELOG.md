# Changelog

This file is the operator-facing release ledger. Every pull request adds one
line under `## Unreleased

### [BREAKING]

- None.

### [FEATURE]

- None.

### [FIX]

- None.

### [INTERNAL]

- None.

### [SECURITY]

- None.

## 0.2.0 — 2026-09-13

### [FEATURE]

- Add packaged-app diagnostics logging with rotating Tauri log files. (#145)
- Typed IPC errors, slice 1: the six backend-session commands reject with `{ code, message }` (`IpcError`), classified at the TCP/handshake/auth/host-key boundary; the renderer branches on the code before falling back to prose matching. (#203)

### [FIX]

- Rename the native SQLite database to `terminalworkspace.db` with a one-time legacy copy migration. (#129)
- Enforce a single running app instance: launching the app again focuses the existing window instead of starting a second process that could race the database migration or the keychain reaper. (#362)
- A host-key mismatch on connect no longer triggers automatic reconnect attempts; the pane stays disconnected with the re-scan hint until the host is explicitly re-trusted. (#373)

### [INTERNAL]

- Replace API endpoint dispatch with a Backend interface. (#156)
- Split AppShell.tsx (1095 lines): command-palette state/rows into useCommandPaletteRows and the palette dialog into CommandPaletteDialog; shell is now under 600 lines with no behaviour change. (#159 slice, #367)
- Split SettingsPage.tsx (1163 lines) into SettingsPreferencesSection and SettingsTrustPolicySection; page is now under 600 lines with no behaviour change. (#159 slice, #366)
- Split TerminalPane lifecycle and viewport safeguards into sibling modules. (#159)
- Split terminal pane session behavior into focused hooks for lifecycle, runtime status, queued commands, and search. (#159)
- Split IPC DTOs into `ipc_types.rs` and the SFTP command family into `sftp.rs`; `main.rs` shrinks by ~700 lines with no invoke() name or payload change. (#355)
- Run ignored native sshd fixtures in a neutral Ubuntu CI job against fixture-owned sshds. (#356)
- Release gates: the updater .sig is verified against the pubkey compiled into the app and latest.json must describe the exact tarball (promote and publish, dry-run included); the five version sources must agree (validate + release check); publish refuses a tag that differs from the promoted version and runs every content gate before the GitHub release is created. (#379)

### [SECURITY]

- Key generation no longer passes the new passphrase to ssh-keygen on argv (it is handed over via SSH_ASKPASS from a 0600 file that is scrubbed on every path, like the rekey path). `scripts/secret-argv-check.mjs` now scans the shell, Node and Rust command lines under scripts/, apps/desktop/server and src-tauri/src for known secret-bearing options carrying a runtime value — same-line, next-statement and glued `option=value` shapes — so the next instance fails validation instead of shipping; the one remaining instance (notarytool Apple-ID `--password`) is on a reviewed, expiring allowlist tracked by #378. (#319)

