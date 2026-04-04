# Release

## Current Release State

- Local native bundles can now be built, signed, notarized, stapled, zipped, and described with a
  machine-readable release manifest for macOS distribution.
- `npm run native:release:check` is the packaging phase gate. It writes release artifacts into
  `artifacts/release/` and verifies the signed bundle contract.
- `npm run native:notarize` is the notarization gate. It submits the release zip to Apple,
  waits for acceptance, staples the ticket, recreates the zip, and updates the manifest.
- `npm run native:promote` is the local promotion gate. It copies the notarized release into the
  stable channel directory with the manifest and checksum file.
- The current bundle identifier is `com.abdenterprises.terminalworkspace`.
- Local notarized distribution is complete in this branch.

## Required Checks Before Shipping

- `npm run native:check`
- `npm run native:key`
- `npm run native:trust`
- `npm run native:release:check`
- `MACOS_NOTARY_PROFILE=<profile> npm run native:notarize`
- `npm run native:promote`
- `TERMSNIP_RUN_E2E=1 npm run validate`
- Native bundle build, notarization, stapling, and promotion verification

## Release Artifacts

- `artifacts/release/latest-macos-release.json`: latest packaging manifest pointer
- `artifacts/release/terminal-workspace-macos-v0.1.0.json`: versioned release manifest
- `artifacts/release/terminal-workspace-macos-v0.1.0.zip`: zipped `.app` bundle
- `artifacts/release/*.codesign-*.txt`: signing verification logs
- `artifacts/release/*.spctl.txt`: Gatekeeper assessment log
- `artifacts/release/*.notary-*.json`: Apple notarization submission and log output
- `artifacts/release/*.stapler-*.txt`: stapling and ticket validation logs
- `artifacts/release/promoted/stable/v0.1.0/`: promoted release zip, manifest, logs, and checksum
- `artifacts/release/promoted/stable/latest-macos-release.json`: latest promoted stable manifest

## Required Environment

- `MACOS_NOTARY_PROFILE` or `NOTARY_PROFILE`: a `notarytool` keychain profile available on the
  current macOS machine. This phase was executed with `BugNarratorNotary`.

## Current Gaps

- Full transport fixture stability still needs hardening for local host environments.
- The repo still depends on a machine-local `notarytool` keychain profile for release automation.
- The repo does not yet publish promoted artifacts through a CI-backed release workflow or GitHub release.
