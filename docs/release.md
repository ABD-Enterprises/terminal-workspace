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

## Release Gates (#379)

- `node scripts/check-version-consistency.mjs` — `package.json`, `apps/desktop/package.json`,
  `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml` and the `terminal-workspace` entry in
  `src-tauri/Cargo.lock` must carry the same version. Runs in `validate` and `native:release:check`.
- `node scripts/verify-updater-signature.mjs` — the promoted `.app.tar.gz.sig` must verify (minisign
  ED / BLAKE2b-512 / ed25519, key id match) against `plugins.updater.pubkey` in `tauri.conf.json`,
  and `latest.json` must name that tarball, carry that signature and the release version. Runs in
  `native:promote` right after signing and in `native:publish` (dry-run included) before the GitHub
  release is created, so a wrong key or a stale feed can never leave a mislabelled release behind.
- `native:publish` refuses a `RELEASE_TAG` that is not `v<manifest.version>`.

## CI Release Path Prerequisites (`release-macos.yml`)

Two owner-side prerequisites gate the CI release path. Both were re-read live on 2026-10-26 —
secret and variable **names** only, never values:

- **Runner.** The `release-macos` job selects its runner as
  `${{ fromJSON(vars.RELEASE_MACOS_RUNNER_LABELS || '["self-hosted","macOS","release-signing"]') }}`.
  The fallback deliberately matches no runner, so the job queues visibly rather than executing
  somewhere unintended, and `RELEASE_MACOS_RUNNER_LABELS` was unset on 2026-10-26. Either register
  a dedicated macOS self-hosted runner carrying `self-hosted`, `macOS` and `release-signing`, or
  register a runner with labels of your own and point the repository variable at them as a JSON
  array. The job must never run on the shared self-hosted pool (that pool executes pull-request
  code) or on a GitHub-hosted runner.
- **Secrets.** Registered as of 2026-10-26: `TAURI_SIGNING_PRIVATE_KEY` and
  `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. The workflow reads the `CI release workflow secrets` list
  under "Required Environment" as GitHub secrets and checks them first in the
  `Validate release secrets` step (`npm run release:secrets:validate-env`); with any one missing it
  exits 1 printing `Missing local signing inputs: <names>`, before the certificate-import step runs
  or anything is signed.

Trigger the workflow with `workflow_dispatch` and its `release_tag` input, or by pushing a `v*`
tag — pushing a release tag is an owner action. With both prerequisites in place the job signs,
notarizes, staples, promotes (emitting the signed `.app.tar.gz`, `latest.json` and `.sig`, because
the workflow runs both promote and publish with `REQUIRE_UPDATER_ARTIFACTS=1`) and publishes the
assets. Until then the local path above is the only release route, and any release published
without the updater triplet leaves installed copies' update checks 404ing (#224).

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
- `artifacts/release/promoted/stable/v0.1.0/terminal-workspace-macos-v0.1.0.dmg`: notarized +
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
  - `MACOS_NOTARY_APPLE_ID` (#378: stored into the keychain profile `terminal-workspace-notary`
    over stdin — the password never appears on argv — and the same profile serves `native:dmg`.
    The profile persists in the login keychain like any `MACOS_NOTARY_PROFILE`; on shared or CI
    machines prefer the App Store Connect key mode, whose key file is removed on exit)
  - `MACOS_NOTARY_APP_PASSWORD`
  - `MACOS_NOTARY_TEAM_ID`
- Local-machine fallback:
  - `MACOS_NOTARY_PROFILE` or `NOTARY_PROFILE`
- CI release workflow secrets:
  - `MACOS_CERTIFICATE_P12_BASE64`
  - `MACOS_CERTIFICATE_PASSWORD`
  - `MACOS_KEYCHAIN_PASSWORD`
  - `MACOS_SIGN_IDENTITY`
  - a notarization credential: `MACOS_NOTARY_KEY_ID`, `MACOS_NOTARY_ISSUER` and
    `MACOS_NOTARY_KEY_BASE64`, or the Apple ID trio above
  - `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (updater feed;
    `REQUIRE_UPDATER_ARTIFACTS=1` in "CI Release Path Prerequisites")

## Current Gaps

- The CI release workflow is implemented but has not yet been exercised with live secrets on this
  repository, and as of 2026-10-26 both prerequisites in "CI Release Path Prerequisites" are still
  unmet: no runner matches the job's label set, and only the two `TAURI_SIGNING_*` secrets are
  registered.
