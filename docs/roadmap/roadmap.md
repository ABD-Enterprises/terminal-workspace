# Roadmap

## Current Focus

Complete native trust and key tooling so the macOS app can own SSH trust establishment and key
management end-to-end while the browser/demo path stays stable for screenshots, review, and
contract coverage.

## Active Phases

- Native trust and key tooling
- Success criteria:
  - native mode routes key inspection, key generation, and known-host scans through Tauri/Rust
  - `npm run native:trust` passes on macOS runners and locally when the fixture SSH daemon can run
  - browser mode retains the backend path without changing the UI contract
  - `src-tauri/src/main.rs` stays focused on app boot and command wiring instead of trust/key internals

## Upcoming Phases

- Packaging and release hardening
- Native transport fixture hardening

## Risks And Opportunities

- Risk: the browser path and native path intentionally diverge now, so transport regressions need both browser validation and macOS-native fixture coverage.
- Risk: the broader macOS localhost transport fixture still depends on an unsandboxed local runtime, so desktop-shell sandboxing can hide valid transport regressions if the wrong command context is used.
- Opportunity: route-level code splitting, the backend proxy seam, Keychain-backed runtime secrets, Rust-owned SSH sessions, forwarding, snippets, native SFTP, and the new localhost fixture harness now give the app a tighter path toward a fully native transport stack.
- Opportunity: trust/key tooling is now on the same native seam as the rest of the connection lifecycle, which makes packaging, signing, notarization, and release diagnostics the next highest-value phase.
