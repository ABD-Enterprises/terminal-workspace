# Roadmap

## Current Focus

Finish native shell quality so the macOS app can own real SSH transport end-to-end while the
browser/demo path stays stable for screenshots, review, and contract coverage.

## Active Phases

- Native shell quality
- Success criteria:
  - direct SSH, jump-host SSH, SFTP, forwarding, and remote snippets run through Rust in the native shell
  - `npm run native:fixtures` passes on macOS runners and locally
  - `src-tauri/src/main.rs` stays focused on app boot and command wiring instead of transport internals
  - `npm run native:build` remains clean after transport changes

## Upcoming Phases

- Native trust and key tooling
- Packaging and release hardening
- Replace the remaining backend-owned native paths for key inspection, generation, and known-host scans

## Risks And Opportunities

- Risk: the browser path and native path intentionally diverge now, so transport regressions need both browser validation and macOS-native fixture coverage.
- Risk: key inspection, generation, and trust scanning still proxy through the Node backend in native mode.
- Opportunity: route-level code splitting, the backend proxy seam, Keychain-backed runtime secrets, Rust-owned SSH sessions, forwarding, snippets, native SFTP, and the new localhost fixture harness now give the app a tighter path toward a fully native transport stack.
