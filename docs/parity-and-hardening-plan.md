# term-snip — Parity & Hardening Execution Plan

Companion to `docs/parity-and-hardening-review.md`. The review diagnosed gaps; this plan phases the fixes by risk, scope, and dependency. Phase 0 lands in the same session as the review (this commit). Phases 1–3 are estimated, ordered by ROI.

## Phasing principle

- **Phase 0 (this session, surgical):** changes that are small, high-confidence, immediately verifiable by `vitest` / `cargo test` / `tsc`, and do not require product decisions.
- **Phase 1 (1–2 week sprint):** medium-sized fixes that unblock the daily-use flows but need a real implementation pass (UI design, registry patterns, addon wiring).
- **Phase 2 (4–6 week sprint):** structural changes — Identity entity, IA collapse, persistence migration. Must come before any sync/team work.
- **Phase 3 (post-1.0):** features that depend on Phase 2 (cloud sync, team vaults, drag-from-Finder, OS notifications).

Each task is tagged with the originating section in the review (`§3.S-1`, `§4.6`, etc.) and an effort estimate.

---

## Phase 0 — Land now

| ID | Task | Effort | Source |
|---|---|---|---|
| P0-S1 | Flip `defaultHostKeyPolicy` to `requireTrusted`. Existing user data unaffected (per-host field is persisted explicitly). Update sample hosts and the `HostEditor` default. | XS | §3.S-1 |
| P0-S2 | Replace `ssh-keygen -p -P <passphrase>` argv exposure with `SSH_ASKPASS` flow: write a session-private askpass script (`0o700`) that prints the passphrase, set `SSH_ASKPASS` + `DISPLAY` + run via `setsid`, scrub the script after. | S | §3.S-2 |
| P0-S4a | Add a strict CSP to `src-tauri/tauri.conf.json`: `default-src 'self'; script-src 'self'; connect-src 'self' http://127.0.0.1:* ws://127.0.0.1:*; style-src 'self' 'unsafe-inline'; img-src 'self' data:`. | XS | §3.S-4 |
| P0-S6 | Add path allowlist to `termsnip_inspect_private_key`: only paths under `~/.ssh/`, `~/Documents/`, `~/Library/Application Support/term-snip/`, or session temp dir. Reject everything else with a clear error. | S | §3.S-6 |
| P0-S7 | Append `codesign --verify --deep --strict --verbose=2` and `spctl -a -t exec -vv` to `scripts/native-release.sh` (or wherever the bundle is finalized) before `native:promote` runs. Fail-closed if either errors. | XS | §3.S-7 |
| P0-UX1 | Restore the richer SSH config parser that was closed with PR #15: `Host *` defaults inheritance, multi-host lines, `ProxyJump`, port + identity inheritance. Keep current parser's tests passing; add the cases from the closed PR. | M | §4.5 |
| P0-UX3 | Add a "Pinned hosts" section to the left sidebar that lists all hosts where `favorite === true`, with one-click connect (reuses existing session if open, else opens new tab). | S | §4.1, §6.9 |
| P0-VAL | `npm run test`, `cargo test --manifest-path src-tauri/Cargo.toml`, `npm --prefix apps/desktop run typecheck`. | — | — |
| P0-DOC | Rescore `FEATURE_PARITY.md` to reflect honest column ("Implemented vs. Daily-use"). | XS | §1 |

**Out of P0 scope (deliberately):** anything that needs a product decision (IA collapse), anything ≥ M effort that touches multiple stores (Identity entity, "needs secrets" prompt redesign), anything that needs a new dependency to be added (xterm SearchAddon, addon-search).

---

## Phase 1 — 1–2 week sprint

Sized for one engineer, no product blockers. Status updated 2026-04-27.

| ID | Task | Effort | Source | Status |
|---|---|---|---|---|
| P1-S3 | Wrap host password / passphrase / private-key bytes in a `SecretBuffer` that supports an explicit zero-fill scrub. `connectClient` calls `scrub()` in `finally` after `client.connect()` resolves or rejects, so our copies are gone the moment ssh2 has consumed them. Documented limit: ssh2 keeps its own internal copy of `password` (string slot is required by the API) and the original JSON-parsed strings remain in V8 heap until GC. | M | §3.S-3 | **✅ Landed** (commit `<phase-1-batch-3>`) |
| P1-S4b | Backend startup mints a per-launch token; Tauri side reads it from a child-process env var or sidecar file; renderer attaches it as `X-Termsnip-Token` and origin must be in the configured allowlist. Reject otherwise with 403. | M | §3.S-4, §3.S-8 | **✅ Landed** (commit `<phase-1-batch-2>`) |
| P1-S5 | New per-key-fingerprint Keychain service `com.termsnip.runtime.key-passphrase`; renderer routes passphrase storage by fingerprint when the host's key is in the keys store. Two hosts sharing the same key share one Keychain entry — type the passphrase once. Per-host passphrase entries are auto-migrated forward on hydrate (read legacy entry → write under fingerprint → clear legacy). Key delete fires GC on the per-fingerprint entry. Argv exposure of `security -w <value>` is a known Phase-2 item — needs `security-framework` FFI which is not in the offline cargo cache. | M | §3.S-5 | **✅ Landed** (commit `<phase-1-batch-4>`) |
| P1-UX2 | When an inactive `pendingSecrets` pane becomes the active tab, auto-trigger `ensureRuntimeSecrets` to open the existing prompt modal (which already exists; the gap was the focus→prompt edge). | S | §4.3 | **✅ Landed** (commit `<phase-1-batch-1>`) |
| P1-UX4 | Add a Tauri menu (App / File / Edit / View / Window / Help) in `src-tauri/src/main.rs`. Standard shortcuts wired: `Cmd+,`, `Cmd+T` (new tab via palette quick-connect), `Cmd+Shift+T` (duplicate), `Cmd+W` (close tab), `Cmd+1`–`6` (section nav), `Cmd+K` (palette), `Cmd+Shift+]`/`[` (cycle tabs). Menu activations bridge to the renderer via `termsnip://menu-event`. `Cmd+F` (search-in-scrollback) waits on P1-UX6. | M | §4.7 | **✅ Landed** (commit `<phase-1-batch-2>`) |
| P1-UX5 | Add keyboard navigation (↑/↓/Enter) to the existing palette, plus an Active-session command surface (duplicate, split-h/v, files, close), plus a Recent surface (rerun last snippet, reconnect last host). The original audit incorrectly characterised the palette as a stub — it has four functional sections; the gap was the missing keyboard model + active-session commands. | M | §4.2 | **✅ Landed** (commit `<phase-1-batch-1>`) |
| P1-UX6 | Built from-scratch search-in-scrollback over xterm's own `buffer.active` + `select` APIs (no addon dep needed). Cmd+F intercepted via `attachCustomKeyEventHandler`; overlay UI shows the input, match count `n/total`, prev/next buttons, case-toggle (Aa), close. Enter / ⌘G next, Shift+Enter / ⇧⌘G prev, Esc close. Match scanning is in `lib/terminal-search.ts` for unit-testability. Search history per pane for the session is deferred (incremental ask, low value vs. the rest). | M | §4.4 | **✅ Landed** (commit `<phase-1-batch-4>`) |
| P1-UX7 | New `lib/terminal-themes.ts` module exposes named palettes (slate-emerald, solarized-dark/light, monokai, nord, high-contrast-light) plus an `auto` mode that follows `prefers-color-scheme`. `app-store` persists the choice; `TerminalPane` hot-applies via `terminal.options.theme` on theme or system change without recreating the terminal (preserves scrollback). Settings page now has a theme picker with live colour previews. | M | §4.4 | **✅ Landed** (commit `<phase-1-batch-3>`) |
| P1-UX8 | xterm copy-on-select via `onSelectionChange` + `navigator.clipboard.writeText`, and right-click paste via a `contextmenu` handler that calls `terminal.paste(clipboardText)`. | XS | §4.4 | **✅ Landed** (commit `<phase-1-batch-1>`) |
| P1-UX9 | Window title binds to active session: `term-snip — <label> (<protocol>)`. Falls back to "term-snip" when no session active. Uses `getCurrentWindow().setTitle()` in Tauri, `document.title` in browser preview. | XS | §4.7 | **✅ Landed** (commit `<phase-1-batch-1>`) |

---

## Phase 2 — 4–6 week sprint (the structural ones)

These can't be done piecemeal; each is one cohesive change.

| ID | Task | Effort | Source |
|---|---|---|---|
| P2-DM1 | **Introduce `Identity` entity.** Schema: `{id, label, username, authMethod, privateKeyPath?, keyId?, hasPassphrase, comment, source}`. Migrate existing host records: derive identities by deduplicating `(authMethod, username, privateKeyPath)` tuples, link hosts via `identityId`. Update `HostEditor` to pick an Identity. Update Keychain keying to identity-id-keyed (replaces the per-fingerprint workaround). | L | §2.1, §6.6 — **Batch 1 ✅ landed** (commit `<p2-dm1-batch-1>`): schema, store, idempotent migration, 25 new tests; runtime still reads per-host fields; no behaviour change. **Batches 2–4 pending**: UI to manage identities + HostEditor picker (B2); switch read path in connections.ts and runtime-secrets, route Keychain by identity (B3); remove deprecated host fields (B4). |
| P2-DM2 | **Collapse organization axes.** Pick one: keep `tags` (multi-valued, free-form) + `folders` (hierarchical FK). Drop `host.group` (string) and the dead `EnvironmentRecord` entity. Migrate existing data. Filter bar supports multi-tag AND folder. | L | §2.2, §6.7 |
| P2-PERSIST | Replace localStorage Zustand persist for hosts/keys/known-hosts/identities/snippets with SQLite via `tauri-plugin-sql`. Browser-mode keeps localStorage as fallback. Add migration path. | L | §2.3, §6.14 |
| P2-NET | Native ship build drops the Node backend. Browser-only path keeps it but with a "demo / preview only" banner. Tauri owns 100% of SSH/SFTP/forwarding/snippets. | L | §5.1, §6.13 |
| P2-FP | First-connect fingerprint UX: when `requireTrusted` is set and an unknown key is encountered, show a modal with the host fingerprint, algorithm, and "Trust" / "Reject" buttons inline. No more separate `/keys?scanHost=` dance. | M | §3.S-1, §6.1 |

---

## Phase 3 — post-1.0

Depends on Phase 2 completing.

| ID | Task | Effort | Source |
|---|---|---|---|
| P3-SYNC | Cloud sync foundation. Now structurally possible because identities are reusable. Encrypt-at-rest with user-derived key. Conflict resolution last-write-wins per record + manual-merge for conflicts. | XL | review §1, §2.1 |
| P3-DRAG | Drag-from-Finder upload to active SFTP pane. macOS file promise / NSPasteboard wiring. | M | §4.1.C |
| P3-NOTIF | Native notifications via `tauri-plugin-notification`: session disconnected, long-running snippet finished, pending-secrets needed. User opt-in per type. | S | §4.7 |
| P3-DOCK | Dock badge with active session count + error indicator. Updates on session state change. | S | §4.7 |
| P3-MOSH | Native Mosh transport. Currently `protocol: "mosh"` exists but uses ssh fallback. | M | §1 |
| P3-IDENTITY-SYNC | SSH agent forward-as-identity: surface running `ssh-agent` keys as Identity records the user can pick without import. | M | §2.1 |
| P3-SHARE | Team vaults (deferred per scope but enabled by P2-DM1). | XL | review §1 |

---

## Risk & rollback

- All Phase 0 changes are guarded by `vitest`, `cargo test`, and `tsc -b`. Each is independently revertable.
- Phase 1 P1-S5 (Keychain rekey) needs a one-time migration script for existing Keychain entries; ship behind a feature flag for one release.
- Phase 2 P2-DM1 and P2-DM2 are **one-way migrations**; ship a JSON export-of-existing-state immediately before the migration runs, recoverable via Settings → Import on rollback.
- Phase 2 P2-NET (kill Node backend in native) needs a flag day announcement; current users on browser-mode preview should not regress.

---

## Definition of done per phase

- **Phase 0:** all P0 tasks land in one commit, tests pass, `FEATURE_PARITY.md` reflects honest scoring, `parity-and-hardening-review.md` is referenced from `README.md`.
- **Phase 1:** the review's "Click-count vs Termius" table flips from 4-of-6 worse to 2-of-6 worse; security findings drop to zero Critical, ≤ 1 High.
- **Phase 2:** Identity entity in production, IA collapsed to (folders + tags), SQLite-backed persistence, Node backend retired in native.
- **Phase 3:** sync alpha for the maintainer's own fleet across two macs.

## What this plan does NOT promise

- Mobile / iPad parity. Out of scope per `README.md` "Initial Scope."
- Termius branding parity (intentional — see review §1).
- Windows or Linux ports.
- Real-time collaboration / terminal sharing — deferred per existing `FEATURE_PARITY.md` row.

---

Cross-references:
- Review: `docs/parity-and-hardening-review.md`
- Existing parity matrix: `FEATURE_PARITY.md` (will be rescored in P0-DOC)
- Architecture: `docs/architecture.md` (will need an update after P2-NET)
- Security: `docs/security.md` (will need an update after every Phase)
