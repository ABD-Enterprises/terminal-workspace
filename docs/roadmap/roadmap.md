# Roadmap

## Current Focus

Harden packaging and release diagnostics so the native macOS app can produce a repeatable signed
bundle, release manifest, CI preview artifact, and machine-readable verification evidence before
notarization and promotion.

## Active Phases

- Packaging and release hardening
- Success criteria:
  - `npm run native:release:check` writes a release manifest, zipped bundle, and verification logs
  - signed local macOS packaging verifies with `codesign`
  - CI publishes a native preview artifact without requiring signing secrets
  - release metadata no longer ships placeholder bundle identifiers

## Upcoming Phases

- Notarization and release promotion
- Multi-surface regression hardening
- Native transport fixture hardening

## Risks And Opportunities

- Risk: the browser path and native path intentionally diverge now, so transport regressions need both browser validation and macOS-native fixture coverage.
- Risk: the local macOS bundle is signed, but it is still not notarized, so Gatekeeper assessment remains a release blocker.
- Risk: the broader macOS localhost transport fixture still depends on an unsandboxed local runtime, so desktop-shell sandboxing can hide valid transport regressions if the wrong command context is used.
- Opportunity: route-level code splitting, the backend proxy seam, Keychain-backed runtime secrets, Rust-owned SSH sessions, forwarding, snippets, native SFTP, and the new localhost fixture harness now give the app a tighter path toward a fully native transport stack.
- Opportunity: the packaging branch now produces release manifests and CI preview artifacts, which makes notarization and promotion automation the next highest-value release phase.
