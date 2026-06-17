# Terminal Workspace

A local-first macOS SSH client — hosts, SSH sessions, SFTP, keys, snippets, and
port forwarding in a native macOS shell.

## Install

Download the latest signed, notarized build from the
[Releases](https://github.com/ABD-Enterprises/terminal-workspace/releases) page,
then move **Terminal Workspace.app** into `/Applications`.

The app checks for updates automatically and installs them in place — watch for
the in-app update banner, or use **Settings → Check for updates**.

## Current State

The native macOS shell owns sessions, SFTP, snippets, forwards, trust, and key tooling. The repo
also includes portable notarization contracts, GitHub release publishing workflow support, fixture
preflight, and sync-ready vault snapshot metadata.

## Quick Start

1. `npm run setup`
2. `npm run dev`
3. Open [http://127.0.0.1:5173/](http://127.0.0.1:5173/)

`setup` installs workspace dependencies through the pinned `pnpm` toolchain,
even if `pnpm` is not already on your shell `PATH`.

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
- `npm run validate` runs the fast local gate: effort guard, lint, unit/integration tests, desktop
  build, and changed-file Semgrep when Docker is available.
- `npm run validate:ci` runs the CI-equivalent gate with browser e2e enabled.
- `npm run validate:full` runs the strongest local gate with browser e2e plus macOS native trust
  tooling when available.

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

More setup detail lives in [docs/development.md](docs/development.md). Active work is tracked in GitHub Issues.

## Contributing

Contributions are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md) for setup, the
local validation gate, and pull-request guidelines. Please report security
issues privately via [SECURITY.md](SECURITY.md) rather than a public issue.

## License

Licensed under the [Apache License 2.0](LICENSE). Copyright 2026 ABD Enterprises.
See [NOTICE](NOTICE) for attribution.
