# Roadmap

## Current Focus

Complete notarization and release promotion so the native macOS app can produce an Apple-accepted,
stapled, Gatekeeper-accepted bundle and a promoted stable-channel release record from the local
automation path.

## Active Phases

- Notarization and release promotion
- Success criteria:
  - `npm run native:notarize` submits the release archive to Apple and records an accepted result
  - `xcrun stapler validate` passes on the release app bundle
  - `spctl --assess` reports `accepted` for the notarized app
  - `npm run native:promote` writes the stable-channel manifest and checksum file

## Upcoming Phases

- Multi-surface regression hardening
- Release credential portability hardening
- Native transport fixture hardening
- Vault and sync architecture

## Risks And Opportunities

- Risk: the browser path and native path intentionally diverge now, so transport regressions need both browser validation and macOS-native fixture coverage.
- Risk: notarization now works locally, but the release automation still depends on a machine-local
  `notarytool` keychain profile.
- Risk: the broader macOS localhost transport fixture still depends on an unsandboxed local runtime, so desktop-shell sandboxing can hide valid transport regressions if the wrong command context is used.
- Opportunity: route-level code splitting, the backend proxy seam, Keychain-backed runtime secrets, Rust-owned SSH sessions, forwarding, snippets, native SFTP, and the new localhost fixture harness now give the app a tighter path toward a fully native transport stack.
- Opportunity: the repo now has a notarized and promoted local macOS release path, which makes
  CI-backed credential portability and published release channels the next highest-value release work.
