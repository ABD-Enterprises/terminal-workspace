# Testing

## Primary Validation Paths

- `npm run test`: Vitest unit and integration coverage for the React stores, API seams, and local
  config utilities.
- `npm run e2e`: Playwright browser smoke against the seeded Vite workspace.
- `npm run native:key`: fast local key inspection and generation fixture that does not require a
  live localhost SSH daemon.
- `npm run native:trust`: macOS localhost fixture for native key inspection, native key generation,
  and native known-host scans.
- `npm run native:fixtures`: broader macOS localhost transport fixture for sessions, SFTP,
  forwarding, and snippets.
- `npm run native:release:check`: packaging gate that builds the macOS bundle, creates the versioned
  zip/manifest pair, and verifies the signed release contract.
- `npm run native:notary:auth:test`: dry-run auth-mode regression for App Store Connect key,
  Apple ID, and keychain-profile notarization flows.
- `MACOS_NOTARY_PROFILE=<profile> npm run native:notarize`: notarization gate that verifies Apple
  acceptance, stapling, and post-notary Gatekeeper acceptance.
- `npm run native:promote`: promotion gate that copies the notarized artifact into the stable
  channel directory and writes a checksum file.
- `npm run native:publish:dry-run`: promoted-release publish dry run for GitHub release assets.
- `TERMSNIP_RUN_E2E=1 npm run validate`: repo-level lint, Vitest, desktop build, macOS native
  trust fixture when available, and browser e2e.

## Execution Notes

- `native:trust` and `native:fixtures` now run `scripts/native-fixture-preflight.sh` first so
  sandboxed or host-restricted environments fail early with explicit guidance instead of partial
  SSH fixture errors.
- `native:trust` is the required validation path for the native trust and key tooling phase.
- `native:release:check` is the required validation path for packaging and release hardening.
- `native:notarize` plus `native:promote` are the required validation paths for notarization and
  release promotion.
- `native:notary:auth:test` is the required fast regression for portable release credentials.
- `native:fixtures` is the broader transport regression suite and now carries an explicit runtime
  preflight before the ignored localhost SSH fixture test runs.
