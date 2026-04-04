# Operations

## Local Runtime

- Browser UI: `npm run dev`
- Native compile sanity: `npm run native:check`
- Native trust/key regression: `npm run native:trust`
- Native transport regression: `npm run native:fixtures`
- Native release packaging gate: `npm run native:release:check`
- Native notarization auth dry run: `npm run native:notary:auth:test`
- Native notarization gate: `MACOS_NOTARY_PROFILE=<profile> npm run native:notarize`
- Native stable promotion gate: `npm run native:promote`
- Native GitHub release publish dry run: `npm run native:publish:dry-run`
- Full browser validation: `TERMSNIP_RUN_E2E=1 npm run validate`

## Operational Expectations

- The browser/demo path is the safest review surface when you need seeded data or screenshots.
- The native shell is the correct surface for real SSH, trust, and secret-storage validation.
- Packaging diagnostics now write their zip, manifest, and signing logs into `artifacts/release/`.
- Notarization and promotion diagnostics write Apple submission data, stapler logs, and stable
  channel artifacts into `artifacts/release/` and `artifacts/release/promoted/`.
- The localhost fixture scripts now preflight temporary `sshd` startup and `ssh-keyscan` before the
  Cargo tests run, so unsupported shells fail with deterministic guidance.
- Release automation loads shared defaults from `.env.shared` and local overrides from `.env`
  without requiring those files in CI.

## Incident Handling

- If browser screens regress, start with `npm run validate`.
- If native trust or secrets regress, start with `npm run native:trust` and the macOS workflow in
  `.github/workflows/validate.yml`.
- If the broader localhost transport path regresses, start with `npm run native:fixtures`; the
  preflight output will tell you immediately whether the host shell can support the fixture.
- If a release artifact regresses, start with `npm run native:release:check` and inspect the
  manifest plus the `codesign` and `spctl` logs in `artifacts/release/`.
- If notarization or promotion regresses, start with `npm run native:notary:auth:test`, then
  `npm run native:notarize`, then inspect the `notarytool` JSON output, the stapler logs, and the
  promoted stable manifest.
- If GitHub release publishing regresses, inspect `.github/workflows/release-macos.yml`,
  `scripts/native-publish-release.sh`, and the promoted release directory contents.
