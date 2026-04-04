# Terminal Workspace

A local-first macOS SSH client starter repo inspired by the usability patterns of Termius.

## Current Focus

The active phase is packaging and release hardening: the native macOS shell already owns sessions,
SFTP, snippets, forwards, trust, and key tooling, and this branch adds release manifests, signed
bundle verification, preview release artifacts in CI, and explicit macOS packaging diagnostics.

## Quick Start

1. `npm run setup`
2. `npm run dev`
3. Open [http://127.0.0.1:5173/](http://127.0.0.1:5173/)

`setup` bootstraps the repo state files and installs workspace dependencies through the pinned
`pnpm` toolchain, even if `pnpm` is not already on your shell `PATH`.

## Validation

- `npm run test` runs unit and integration coverage through the root Vitest config.
- `npm run e2e` runs Playwright against the Vite app and writes screenshots to `artifacts/e2e/`.
- `npm run native:key` runs the fast local native key inspection and generation fixture.
- `npm run native:trust` runs the macOS localhost trust/key fixture for native key inspection,
  generation, and known-host scans.
- `npm run native:release:check` builds the native app bundle, writes a release manifest into
  `artifacts/release/`, and verifies the signed macOS package contract.
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
manifest, signed bundle verification, and CI preview artifacts ahead of notarization and promotion.

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

## Native Validation

- `npm run native:icons` generates the Tauri icon set from `apps/desktop/public/favicon.svg`
- `npm run native:check` regenerates icons and runs `cargo check --manifest-path src-tauri/Cargo.toml`
- `npm run native:key` runs the fast local key inspection and generation fixture
- `npm run native:trust` runs the macOS localhost trust/key fixture for key inspection, generation,
  and known-host scans
- `npm run native:fixtures` runs the macOS localhost transport fixture for direct SSH, jump-host SSH, SFTP, forwards, and snippets
- `npm run native:release:check` writes `artifacts/release/latest-macos-release.json` plus the
  versioned zip, manifest, and signing logs for the current native bundle
- `npm run native:build` regenerates icons and runs `cargo build --manifest-path src-tauri/Cargo.toml`

More setup and milestone detail lives in [docs/development.md](/Users/deffenda/Code/term-snip/docs/development.md) and [docs/roadmap/roadmap.md](/Users/deffenda/Code/term-snip/docs/roadmap/roadmap.md).
