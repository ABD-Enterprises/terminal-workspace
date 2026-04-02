# Development

## Setup

- Run `npm run setup` from a fresh checkout.
- The setup flow uses `scripts/pnpmw.mjs` to resolve the pinned `pnpm` version through `pnpm`, `corepack`, or `npx`.
- Workspace install is configured to allow required native/build scripts for `cpu-features`, `esbuild`, and `ssh2`, so fresh installs do not require a manual `pnpm approve-builds` step.

## Day-to-Day Commands

- `npm run dev`: backend + Vite UI on `127.0.0.1:5173`
- `npm run dev:ui`: Vite UI only on `127.0.0.1:5173`
- `npm run test`: root Vitest unit + integration suite
- `npm run e2e`: Playwright browser suite
- `npm run build`: desktop production build
- `TERMSNIP_RUN_E2E=1 npm run validate`: full lint/test/build/e2e pass

## Demo Mode

Demo mode is the default operator experience for this milestone. It exists to keep the seeded app
fully reviewable without real SSH infrastructure.

- Sessions connect through the mock terminal transport.
- Transfers use a deterministic in-memory filesystem keyed by host.
- Key inspection, generation, known-host scans, snippet execution, and forward management return
  stable mock responses.
- The toggle lives in Settings and is persisted in the app preference store.

## Native Shell Bridge

The native shell now owns the app-facing transport seam:

- Tauri exposes backend status plus JSON and binary proxy commands for the native webview.
- Tauri exposes session lifecycle commands for create, resize, and close.
- Direct non-jump-host SSH sessions now connect in Rust instead of through the Node backend.
- Tauri still owns the session stream bridge: native sessions emit terminal events directly, while
  backend-owned sessions continue to proxy websocket frames into the webview.
- Runtime passwords and passphrases persist through macOS Keychain in native mode.

The Node backend still owns jump-host SSH, SFTP, snippet, key, and forwarding operations, so demo
mode remains the safest default path while the Rust transport grows.

## Browser Coverage

The Playwright suite exercises the seeded workspace and captures route screenshots into
`artifacts/e2e/`. The current smoke flow covers:

- hosts
- sessions
- snippets
- keys
- transfers
- settings

## Milestone Choice

The repo is currently optimized for web demo quality first. Native shell quality remains the next
phase once the browser-visible workspace is stable, testable, and easy to bootstrap.
