# Testing

## Primary Validation Paths

- `npm run test`: Vitest unit and integration coverage for the React stores, API seams, and local
  config utilities.
- `npm run e2e`: Playwright browser smoke against the seeded Vite workspace.
- `npm run backend:fixtures`: boots the REAL `apps/desktop/server/backend.mjs` against a throwaway
  localhost sshd and drives connect, terminal I/O, exec, and SFTP through its actual HTTP and
  WebSocket surface. Required in CI (macOS job); locally opt-in via
  `TERMSNIP_RUN_BACKEND_FIXTURE=1` because it needs a real sshd.
- `npm run native:key`: fast local key inspection and generation fixture that does not require a
  live localhost SSH daemon.
- `npm run native:trust`: macOS localhost fixture for native key inspection, native key generation,
  and native known-host scans.
- `npm run native:fixtures`: broader macOS localhost transport fixture for sessions, SFTP,
  forwarding, and snippets.
- `npm run native:release:check`: packaging gate that builds the macOS bundle, creates the versioned
  zip/manifest pair, and verifies the signed release contract.
- `npm run native:notary:auth:test`: dry-run auth-mode regression for App Store Connect key,
  Apple ID, and keychain-profile notarization flows.
- `MACOS_NOTARY_PROFILE=<profile> npm run native:notarize`: notarization gate that verifies Apple
  acceptance, stapling, and post-notary Gatekeeper acceptance.
- `npm run native:promote`: promotion gate that copies the notarized artifact into the stable
  channel directory and writes a checksum file.
- `npm run native:publish:dry-run`: promoted-release publish dry run for GitHub release assets.
- `npm run validate`: fast local effort guard, lint, Vitest, desktop build, and changed-file
  Semgrep when Docker is available.
- `npm run validate:ci`: CI-equivalent gate with browser e2e enabled.
- `npm run validate:full`: strongest local gate with browser e2e plus macOS native trust tooling
  when available.

## Coverage Boundary

Worth stating plainly, because the shape of this suite is easy to misread (#185).

Almost everything here proves **UI wiring against mocks**. Playwright boots Vite in demo mode, and
the Vitest integration suite exercises `resetDemoBackend()` or the extracted helper modules — none
of it binds a port or opens a socket. For a long time that meant lint, Vitest and e2e could all be
green while the real SSH/SFTP transport, the auth gate, or the session lifecycle was broken: CI
green, shipped app unable to open a session.

`npm run backend:fixtures` is the one automated path that closes that gap. It proves:

- the real backend entrypoint binds localhost and stays up across the run;
- HTTP **and** WebSocket requests pass through the real auth gate, with the Origin and token
  branches exercised *separately* so one cannot mask a regression in the other;
- an unlisted Origin is refused on both surfaces;
- `ssh2` completes a real public-key handshake against a live sshd;
- session create → WebSocket `connected` → input reaches the remote → its output comes back;
- the exec endpoint (a different ssh2 code path from the interactive shell) runs a command and
  returns its stdout;
- the SFTP endpoint opens a real SFTP channel and lists a seeded file under `sftpRoot`.

It does **not** prove:

- anything about the Tauri/native transport — that is the Rust fixture suite
  (`TERMSNIP_RUN_SSH_FIXTURE=1`), which covers a separate implementation of the same operations;
- browser rendering or UI behaviour — no browser is involved;
- password or keyboard-interactive auth, jump hosts, or mosh — the fixture is a single direct
  public-key host;
- upload, download, rename or delete — only `list` is driven today;
- behaviour on Linux or Windows; it is macOS-only, matching the existing sshd fixture.

## Execution Notes

- `native:trust` and `native:fixtures` now run `scripts/native-fixture-preflight.sh` first so
  sandboxed or host-restricted environments fail early with explicit guidance instead of partial
  SSH fixture errors.
- `native:trust` is the required validation path for the native trust and key tooling phase.
- `native:release:check` is the required validation path for packaging and release hardening.
- `native:notarize` plus `native:promote` are the required validation paths for notarization and
  release promotion.
- `native:notary:auth:test` is the required fast regression for portable release credentials.
- `native:fixtures` is the broader transport regression suite and now carries an explicit runtime
  preflight before the ignored localhost SSH fixture test runs.
