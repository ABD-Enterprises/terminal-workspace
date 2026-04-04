# Operations

## Local Runtime

- Browser UI: `npm run dev`
- Native compile sanity: `npm run native:check`
- Native trust/key regression: `npm run native:trust`
- Native release packaging gate: `npm run native:release:check`
- Native notarization gate: `MACOS_NOTARY_PROFILE=<profile> npm run native:notarize`
- Native stable promotion gate: `npm run native:promote`
- Full browser validation: `TERMSNIP_RUN_E2E=1 npm run validate`

## Operational Expectations

- The browser/demo path is the safest review surface when you need seeded data or screenshots.
- The native shell is the correct surface for real SSH, trust, and secret-storage validation.
- Packaging diagnostics now write their zip, manifest, and signing logs into `artifacts/release/`.
- Notarization and promotion diagnostics write Apple submission data, stapler logs, and stable
  channel artifacts into `artifacts/release/` and `artifacts/release/promoted/`.
- macOS localhost fixture tests may require an unsandboxed shell because they spawn temporary
  `sshd` processes.

## Incident Handling

- If browser screens regress, start with `npm run validate`.
- If native trust or secrets regress, start with `npm run native:trust` and the macOS workflow in
  `.github/workflows/validate.yml`.
- If a release artifact regresses, start with `npm run native:release:check` and inspect the
  manifest plus the `codesign` and `spctl` logs in `artifacts/release/`.
- If notarization or promotion regresses, start with `npm run native:notarize`, then inspect the
  `notarytool` JSON output, the stapler logs, and the promoted stable manifest.
- If the broader transport fixture regresses locally after trust validation passes, treat it as a
  transport-fixture hardening issue unless the failure is reproducible on CI.
