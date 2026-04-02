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
- Optional macOS Keychain integration for runtime secrets

## Risks And Opportunities

- Risk: the current production bundle is still large and should be split once the demo milestone settles.
- Opportunity: the demo backend now provides a reliable seam for future contract tests against the real Rust/Tauri transport.
