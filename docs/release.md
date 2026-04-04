# Release

## Current Release State

- Local native bundles can be built and signed for macOS testing.
- The next planned release phase is packaging and release hardening.
- Notarized distribution is not complete in this branch.

## Required Checks Before Shipping

- `npm run native:check`
- `npm run native:key`
- `npm run native:trust`
- `TERMSNIP_RUN_E2E=1 npm run validate`
- Native bundle build and signing verification

## Current Gaps

- Full transport fixture stability still needs hardening for local host environments.
- The repo does not yet treat notarization as a default automated release step.
