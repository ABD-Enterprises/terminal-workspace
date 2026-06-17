# Release

## Current Release State

- Local native bundles can now be built, signed, notarized, stapled, zipped, and described with a
  machine-readable release manifest for macOS distribution.
- Release manifests now include stable basenames and relative paths so promoted metadata is usable
  outside the local runner workspace.
- `npm run native:release:check` is the packaging phase gate. It writes release artifacts into
  `artifacts/release/` and verifies the signed bundle contract.
- `npm run native:notary:auth:test` proves that the repo resolves App Store Connect key auth,
  Apple ID auth, and keychain-profile auth correctly before a live notarization run.
- `npm run native:notarize` is the notarization gate. It submits the release zip to Apple, waits
  for acceptance, staples the ticket, recreates the zip, and updates the manifest.
- `npm run native:promote` is the local promotion gate. It copies the notarized release into the
  stable channel directory with the manifest, checksum file, and release notes.
- `npm run native:dmg` builds the notarized + stapled `.dmg` installer from the stapled `.app` and
  places it in the promotion directory so `native:publish` uploads it. Run it after
  `native:promote`; it skips cleanly when no notary keychain profile is configured.
- `npm run native:publish:dry-run` validates the promoted GitHub release asset set without
  publishing it.
- `.github/workflows/release-macos.yml` is the CI-backed release path for signing, notarization,
  promotion, and GitHub release publishing.
- The current bundle identifier is `com.abdenterprises.terminalworkspace`.
- Local notarized distribution is complete in this branch, and CI release publishing is now
  implemented but not yet executed with repository secrets.

## Required Checks Before Shipping

- `npm run native:check`
- `npm run native:key`
- `npm run native:trust`
- `npm run native:fixtures`
- `npm run native:release:check`
- `npm run native:notary:auth:test`
- `MACOS_NOTARY_PROFILE=<profile> npm run native:notarize`
- `npm run native:promote`
- `MACOS_NOTARY_PROFILE=<profile> npm run native:dmg`
- `npm run native:publish:dry-run`
- `npm run validate:full`
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
- `artifacts/release/promoted/stable/v0.1.0/terminal-workspace-macos-v0.1.0.app.dmg`: notarized +
  stapled DMG installer uploaded to the GitHub release
- `artifacts/release/promoted/stable/latest-macos-release.json`: latest promoted stable manifest
- `artifacts/release/promoted/stable/v0.1.0/RELEASE_NOTES.md`: promoted release notes used by the
  GitHub release publish step

## Required Environment

- `.env.shared`: shared non-secret defaults such as the release channel
- `.env`: optional local overrides
- `MACOS_SIGN_IDENTITY`: optional local override for the Developer ID Application identity
- Preferred notarization auth:
  - `MACOS_NOTARY_KEY_ID`
  - `MACOS_NOTARY_ISSUER`
  - `MACOS_NOTARY_KEY_BASE64` or `MACOS_NOTARY_KEY_PATH`
- Apple ID fallback:
  - `MACOS_NOTARY_APPLE_ID`
  - `MACOS_NOTARY_APP_PASSWORD`
  - `MACOS_NOTARY_TEAM_ID`
- Local-machine fallback:
  - `MACOS_NOTARY_PROFILE` or `NOTARY_PROFILE`
- CI release workflow secrets:
  - `MACOS_CERTIFICATE_P12_BASE64`
  - `MACOS_CERTIFICATE_PASSWORD`
  - `MACOS_KEYCHAIN_PASSWORD`
  - `MACOS_SIGN_IDENTITY`

## Current Gaps

- The CI release workflow is implemented but has not yet been exercised with live GitHub secrets on
  this repository.
