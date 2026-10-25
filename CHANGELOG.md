# Changelog

This file is the operator-facing release ledger. Every pull request adds one
line under `## Unreleased`, which `scripts/roll-changelog.mjs` rolls into a dated
version section at release time.

## Unreleased

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

## 0.2.1 — 2026-10-24

### [FIX]

- Restore the `.semgrep/rules` submodule pin to `40b8c63`. It had been moved to `0a44eab`, a commit that does not exist upstream, which failed the `validate` gate on every PR and every Dependabot update job.

### [INTERNAL]

- The semgrep gate now runs against a pinned ruleset: a git submodule of semgrep/semgrep-rules at one commit plus a generated manifest (.semgrep/rules.tsv) of the c/auto rule ids resolved to files, with metrics off and no registry fallback, so nothing is fetched at scan time. The rules are never copied into this public repo (Semgrep Rules License v1.0 forbids redistribution). Owner, 90/120-day cadence (enforced by validate.sh), parity numbers and the refresh script are recorded in .semgrep/README.md. (#284)
- Split terminal pane lifecycle concerns into focused modules with behavior tests. (#375)
- Retire the last ORC leftovers (#394): Dependabot PRs no longer get the `chore:trivial` run-presence waiver label, the PR template no longer describes the removed ORC auto-merge gate, and the empty `.github/auto-merge-allowed-authors` allowlist is deleted.
- AGENTS.md now carries the fleet core and this repository's rules (validation, merge, changelog, release and signing, live data); CLAUDE.md only imports it. (#412)
- Audit the pending changelog fragments against the tree before the next release roll: correct the stale self-hosted-runner and glib claims, and merge the two overlapping rustls entries into one line stating the final version. (#418)
- CI jobs now select their runners through variables rather than fixed labels — `LINUX_RUNNER_LABELS` for Validate's Linux jobs and CodeQL, `MACOS_RUNNER_LABELS` for the Rust build/test job, and `RELEASE_MACOS_RUNNER_LABELS` for the signing release job (whose fallback matches no runner on purpose) — so re-pointing CI is a variable change, not a workflow edit. Every checkout starts from fresh Git metadata and no longer persists the token.
- Explicitly disable setup-node's package-manager cache in both validate jobs (#424)
- CodeQL runs the `security-extended` suite again. Removing `orc-codeql.yml` in #400 had silently dropped coverage to the default suite.
- Bump the cargo group in src-tauri: tauri 2.11.5 → 2.12.5 (the native stack follows: wry 0.57, tao 0.37, minisign-verify 0.3.0), tauri-plugin-sql 2.4.1 → 2.6.0, tauri-plugin-updater 2.11.0 → 2.14.0, plus tauri-plugin-single-instance, tauri-plugin-log, tauri-build, tokio, serde_json and sha2; the regenerated ACL manifest picks up tauri 2.12's newly declared core:app exit and core:window set_fullscreen_on_monitor permissions without changing what the app grants (#414)
- Recover the three ignored keychain round-trip tests by running them against a throwaway keychain in an isolated HOME, and widen the self-hosted keychain test skip to match. (#419)
- Remove the unused Gemini Code Assist GitHub App configuration.
- The `npm run validate` bullets in README, development, testing and contributing docs now say the changed-file Semgrep gate is required and fails rather than skips without Docker, matching `scripts/validate.sh` and AGENTS.md. (#423)
- `npm run validate:full` now also runs the real backend transport fixture (macOS only, where the gate already runs it), so the strongest local gate covers the auth gate, session lifecycle, exec, SFTP and websocket paths CI already exercises. (#420)

### [SECURITY]

- Apple-ID notarization no longer passes the app-specific password on argv: `native:notarize` stores it into a keychain profile over stdin and authenticates through the profile (which `native:dmg` can reuse). The last entry on the secret-argv allowlist is gone. (#378)
- The Node backend now imports a private key with an exclusive create (`O_EXCL`), so a key that appears between the existence check and the write is refused instead of overwritten. It also reads `~/.ssh` Include matches through one file handle, so the size and type checks apply to the bytes actually read (CodeQL `js/file-system-race`).
- Bump transitive packages in pnpm-lock.yaml: shell-quote 1.10.0 → 1.12.0 (Dependabot alert 49, critical) and source-map-js 1.2.1 → 1.2.2 (alert 48, high) via `pnpm.overrides`. The Rust `glib` advisory (alert 6) is dismissed as a tolerable risk: tao target-gates gtk to Linux/BSD, so the shipped macOS app never links glib, and the 0.20 fix is unreachable while gtk stays at 0.18.
- Bump transitive dev-tooling packages in pnpm-lock.yaml: browserslist 4.28.1 → 4.29.1 (GHSA-73wf-gq98-2v4g), baseline-browser-mapping 2.10.12 → 2.11.26 (GHSA-w5vr-8v7q-w6rv) and brace-expansion 5.0.9 → 5.0.12 (GHSA-q2hr-2g5m-vwhr and two earlier advisories). `pnpm audit` is now clean. (#402)
- Clear the dev-dependency advisory backlog: vite 8.2.2 → 8.3.5 (launch-editor command injection, `server.fs.allow` leaks), happy-dom 20.14.0 → 21.0.4 (GHSA-834v-8h66-3h79, incomplete fix for CVE-2026-33943), vitest 5.0.0 → 5.0.5 (`@vitest/mocker` injection + traversal) and transitive zod 4.4.3 → 4.6.7 (GHSA-mrhx-c7xc-m3w5); `pnpm audit` is now clean in prod and dev. vite 8.3.5 and happy-dom 21.0.4 join `minimumReleaseAgeExclude` as version-scoped cooldown exceptions (#416)
- pnpm-workspace.yaml now sets trustPolicy: no-downgrade, blockExoticSubdeps: true and minimumReleaseAge: 10080 (7 days), the guards that the semgrep package_managers.pnpm rules check for. No installed version changes. (#386)
- Bump `rustls` 0.23.40 → 0.23.46, `rustls-webpki` and `webpki-root-certs` to patched versions, clearing seven RustSec advisories — including RUSTSEC-2026-0285 (TLS 1.3 handshake messages accepted across encryption level boundaries), which had blocked every PR since 2026-09-14 (#384, #413). The three `zip` advisories are recorded as accepted: `zip` is compiled only for Windows targets and the app ships macOS-only.
- The macOS release workflow no longer restores or saves a pnpm store cache and sets `package-manager-cache: false` on `setup-node`, so the job that signs, notarizes and publishes the app cannot consume a poisoned cache (zizmor cache-poisoning).

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

