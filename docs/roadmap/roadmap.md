# Roadmap

## Current Focus

Close the remaining medium-risk hardening gaps: browser/native regression drift, localhost native
fixture ergonomics, and portable release credentials/publishing. The next product phase is vault
and sync architecture now that the release path and native transport seam are stabilized.

## Active Phases

- Release credential portability hardening
- Success criteria:
  - `npm run native:notary:auth:test` passes for profile, App Store Connect key, and Apple ID auth
  - `npm run native:notarize` still records an accepted Apple submission
  - `npm run native:promote` writes the stable-channel manifest, checksum file, and release notes
  - `npm run native:publish:dry-run` validates the promoted GitHub release asset set
  - `.github/workflows/release-macos.yml` carries the CI-backed signing/notarization/publish path

## Upcoming Phases

- Vault and sync architecture
- Live GitHub release workflow verification

## Risks And Opportunities

- Risk: the GitHub-hosted release workflow is implemented but has not yet been executed with live
  repository secrets, so CI-backed release publishing still needs one real verification pass.
- Opportunity: route-level code splitting, the backend proxy seam, Keychain-backed runtime secrets, Rust-owned SSH sessions, forwarding, snippets, native SFTP, and the new localhost fixture harness now give the app a tighter path toward a fully native transport stack.
- Opportunity: the exported local vault snapshot now carries stable vault and device identifiers,
  which gives the future sync architecture a concrete metadata contract instead of a flat config dump.
