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
- `TERMSNIP_RUN_E2E=1 npm run validate`: repo-level lint, Vitest, desktop build, macOS native
  trust fixture when available, and browser e2e.

## Execution Notes

- The native fixture suites start temporary localhost `sshd` processes. On sandboxed local runs,
  they may need to be executed outside the shell sandbox to produce valid results.
- `native:trust` is the required validation path for the native trust and key tooling phase.
- `native:release:check` is the required validation path for packaging and release hardening.
- `native:fixtures` remains the broader transport regression suite and may still fail on host setups
  where localhost `sshd` forwarding is restricted; treat that as a tracked transport-fixture risk,
  not as silent skipped coverage.
