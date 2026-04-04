# Release

## Current Release State

- Local native bundles can now be built, signed, zipped, and described with a machine-readable
  release manifest for macOS testing.
- `npm run native:release:check` is the packaging phase gate. It writes release artifacts into
  `artifacts/release/` and verifies the signed bundle contract.
- The current bundle identifier is `com.abdenterprises.terminalworkspace`.
- Notarized distribution is still not complete in this branch.

## Required Checks Before Shipping

- `npm run native:check`
- `npm run native:key`
- `npm run native:trust`
- `npm run native:release:check`
- `TERMSNIP_RUN_E2E=1 npm run validate`
- Native bundle build and signing verification

## Release Artifacts

- `artifacts/release/latest-macos-release.json`: latest packaging manifest pointer
- `artifacts/release/terminal-workspace-macos-v0.1.0.json`: versioned release manifest
- `artifacts/release/terminal-workspace-macos-v0.1.0.zip`: zipped `.app` bundle
- `artifacts/release/*.codesign-*.txt`: signing verification logs
- `artifacts/release/*.spctl.txt`: Gatekeeper assessment log

## Current Gaps

- Full transport fixture stability still needs hardening for local host environments.
- The repo does not yet notarize the macOS bundle, so `spctl` still reports `not_accepted`.
- The repo does not yet treat notarization and promotion as a default automated release step.
