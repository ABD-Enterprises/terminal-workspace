# Terminal Workspace

A local-first macOS SSH client starter repo inspired by the usability patterns of Termius.

## Current Focus

The active milestone is web demo quality: the React/Vite workspace should boot from a fresh checkout,
render the primary flows without real SSH material, and stay covered by browser smoke tests before
the project shifts deeper into native-shell hardening.

## Quick Start

1. `npm run setup`
2. `npm run dev`
3. Open [http://127.0.0.1:5173/](http://127.0.0.1:5173/)

`setup` bootstraps the repo state files and installs workspace dependencies through the pinned
`pnpm` toolchain, even if `pnpm` is not already on your shell `PATH`.

## Validation

- `npm run test` runs unit and integration coverage through the root Vitest config.
- `npm run e2e` runs Playwright against the Vite app and writes screenshots to `artifacts/e2e/`.
- `TERMSNIP_RUN_E2E=1 npm run validate` runs lint, unit/integration tests, build, and browser e2e.

## Demo Mode

Demo mode is enabled by default and can be toggled in Settings. When enabled:

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
- runtime passwords and passphrases persist through macOS Keychain in native mode

SFTP, snippets, forwards, and the browser build still use the backend path while that transport
responsibility moves deeper into `src-tauri`.

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

- `pnpm native:icons` generates the Tauri icon set from `apps/desktop/public/favicon.svg`
- `pnpm native:check` regenerates icons and runs `cargo check --manifest-path src-tauri/Cargo.toml`
- `pnpm native:build` regenerates icons and runs `cargo build --manifest-path src-tauri/Cargo.toml`

More setup and milestone detail lives in [docs/development.md](/Users/deffenda/Code/term-snip/docs/development.md) and [docs/roadmap/roadmap.md](/Users/deffenda/Code/term-snip/docs/roadmap/roadmap.md).
