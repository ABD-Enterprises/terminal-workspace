# Terminal Workspace

A local-first macOS SSH client starter repo inspired by the usability patterns of Termius.

## Execution System

This repository is self-contained and stateful:

- first-read AI workflow entrypoint lives in [ai/bootstrap.md](/Users/deffenda/Code/term-snip/ai/bootstrap.md)
- canonical roadmap state lives in [docs/roadmap/state.json](/Users/deffenda/Code/term-snip/docs/roadmap/state.json)
- shared execution state lives in `/state/*`
- build, test, run, and deploy evidence live in [state/artifacts.json](/Users/deffenda/Code/term-snip/state/artifacts.json)
- agent and prompt contracts live in `/agents` and `/prompts`
- runtime enforcement lives in [tools/validators/enforce-runtime-guardrails.js](/Users/deffenda/Code/term-snip/tools/validators/enforce-runtime-guardrails.js)
- PR enforcement lives in [.github/workflows/ci.yml](/Users/deffenda/Code/term-snip/.github/workflows/ci.yml)

## Current Focus

The active hardening branch closes the remaining medium-risk gaps around browser/native regression
coverage, localhost native fixture execution, and portable release automation. The native macOS
shell already owns sessions, SFTP, snippets, forwards, trust, and key tooling; this branch adds a
portable notarization contract, GitHub release publishing workflow, fixture preflight, and sync-ready
vault snapshot metadata.

## Quick Start

1. `npm run setup`
2. `npm run dev`
3. Open [http://127.0.0.1:5173/](http://127.0.0.1:5173/)

`setup` bootstraps the repo state files and installs workspace dependencies through the pinned
`pnpm` toolchain, even if `pnpm` is not already on your shell `PATH`.

Shared non-secret defaults now live in `.env.shared`, `.env.example` documents the local and CI
release contract, and `.env` remains the local override file.

## Validation

- `npm run test` runs unit and integration coverage through the root Vitest config.
- `npm run e2e` runs Playwright against the Vite app and writes screenshots to `artifacts/e2e/`.
- `npm run native:key` runs the fast local native key inspection and generation fixture.
- `npm run native:trust` runs the macOS localhost trust/key fixture for native key inspection,
  generation, and known-host scans.
- `npm run native:release:check` builds the native app bundle, writes a release manifest into
  `artifacts/release/`, and verifies the signed macOS package contract.
- `npm run native:notary:auth:test` proves that App Store Connect key auth, Apple ID auth, and
  local keychain-profile auth all resolve correctly without submitting to Apple.
- `npm run native:notarize` rebuilds the signed bundle, submits the zip for notarization, staples
  the accepted ticket, recreates the zip, and updates the release manifest.
- `npm run native:promote` promotes an accepted notarized release into
  `artifacts/release/promoted/stable/`.
- `npm run native:publish:dry-run` validates the promoted GitHub release asset set without
  creating or uploading a release.
- `npm run validate:guardrails` runs the config-driven repository runtime guardrails validator with `ai.config.json`.
- `TERMSNIP_RUN_E2E=1 npm run validate` runs lint, unit/integration tests, build, macOS native
  trust tooling when available, and browser e2e.

## Demo Mode

Demo mode is enabled by default in the browser review surface and disabled by default in the native
Tauri shell. It can be toggled in Settings. When enabled:

- sessions stay on the in-app mock terminal transport
- SFTP uses a deterministic in-memory filesystem
- key inspection, generation, host trust scans, snippet broadcast, and forwarding use mock responses

This keeps the seeded workspace usable for screenshots, product review, and browser tests without
depending on local SSH keys or reachable infrastructure.

## Native Bridge

The native-shell bridge now covers the app-facing transport seam:

- the browser build still talks to the backend directly
- the Tauri shell proxies backend JSON and binary APIs for the native webview
- direct SSH and jump-host session lifecycle plus terminal stream transport are owned by Rust commands
- native SFTP list, mkdir, rename, delete, upload, and download now run through OpenSSH from Rust
- native local and remote forwards now run through OpenSSH control sessions from Rust
- native remote snippet execution now runs through the same Rust-owned SSH control path
- native key inspection and key generation now run through Rust-owned `ssh-keygen` calls
- native known-host scanning now runs through Rust-owned `ssh-keyscan` plus local fingerprint
  verification
- runtime passwords and passphrases persist through macOS Keychain in native mode

The browser build still uses the backend path by design, while the native shell now adds a release
manifest, signed bundle verification, notarization, stapling, and stable promotion artifacts.

## Scope

### Initial Scope

- Hosts
- SSH sessions
- Tabs and splits
- Keys
- SFTP
- Snippets
- Forwarding
- Session restore

### Deferred

- Cloud sync
- Team collaboration
- Multiplayer sessions

The local vault snapshot now carries `vaultId`, `sourceDeviceId`, and `snapshotId` metadata so the
future sync architecture has stable identifiers without exporting runtime secrets.

## Native Validation

- `npm run native:icons` generates the Tauri icon set from `apps/desktop/public/favicon.svg`
- `npm run native:check` regenerates icons and runs `cargo check --manifest-path src-tauri/Cargo.toml`
- `npm run native:key` runs the fast local key inspection and generation fixture
- `npm run native:trust` runs the macOS localhost trust/key fixture for key inspection, generation,
  and known-host scans
- `npm run native:fixtures` runs the macOS localhost transport fixture for direct SSH, jump-host
  SSH, SFTP, forwards, and snippets after a local fixture preflight confirms the host shell can
  launch and scan a temporary `sshd`
- `npm run native:release:check` writes `artifacts/release/latest-macos-release.json` plus the
  versioned zip, manifest, and signing logs for the current native bundle
- `npm run native:notary:auth:test` validates release auth-mode selection for profile, App Store
  Connect key, and Apple ID flows
- `npm run native:notarize` records the Apple submission ID, notary log, stapler logs, and
  post-notary Gatekeeper assessment in the same manifest
- `npm run native:promote` copies the notarized release, manifest, logs, and checksum file into the
  stable promotion channel directory
- `.github/workflows/release-macos.yml` signs, notarizes, promotes, and publishes a GitHub release
  from CI when the required certificate and notarization secrets are present
- `npm run native:build` regenerates icons and runs `cargo build --manifest-path src-tauri/Cargo.toml`

More setup and milestone detail lives in [docs/development.md](/Users/deffenda/Code/term-snip/docs/development.md) and [docs/roadmap/roadmap.md](/Users/deffenda/Code/term-snip/docs/roadmap/roadmap.md).
