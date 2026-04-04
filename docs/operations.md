# Operations

## Local Runtime

- Browser UI: `npm run dev`
- Native compile sanity: `npm run native:check`
- Native trust/key regression: `npm run native:trust`
- Full browser validation: `TERMSNIP_RUN_E2E=1 npm run validate`

## Operational Expectations

- The browser/demo path is the safest review surface when you need seeded data or screenshots.
- The native shell is the correct surface for real SSH, trust, and secret-storage validation.
- macOS localhost fixture tests may require an unsandboxed shell because they spawn temporary
  `sshd` processes.

## Incident Handling

- If browser screens regress, start with `npm run validate`.
- If native trust or secrets regress, start with `npm run native:trust` and the macOS workflow in
  `.github/workflows/validate.yml`.
- If the broader transport fixture regresses locally after trust validation passes, treat it as a
  transport-fixture hardening issue unless the failure is reproducible on CI.
