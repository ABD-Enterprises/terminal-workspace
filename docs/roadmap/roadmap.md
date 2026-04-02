# Roadmap

## Current Focus

Stabilize the web demo workspace so a fresh checkout can boot, validate, and produce browser-safe
screenshots without any live SSH infrastructure.

## Active Phases

- Web demo quality
- Success criteria:
  - `npm run setup` works from a fresh shell without a global `pnpm`
  - `npm run dev`, `npm run test`, `npm run e2e`, and `npm run validate` are all documented and runnable
  - Hosts, Sessions, Snippets, Keys, Transfers, and Settings render cleanly with seeded demo data
  - Browser smoke tests capture the six primary routes

## Upcoming Phases

- Native shell quality
- Transport hardening inside the Tauri shell
- Replace more of the Node transport layer with Rust-owned SSH and SFTP

## Risks And Opportunities

- Risk: jump-host SSH, SFTP, and forwarding still depend on the Node backend, so native mode is only partially migrated.
- Opportunity: route-level code splitting, the backend proxy seam, Keychain-backed runtime secrets, and direct Rust-owned SSH sessions now give the app a cleaner path for replacing the remaining Node transport without reshaping the React workspace.
