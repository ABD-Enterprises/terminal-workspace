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
- Fast local validation: `npm run validate`
- CI-equivalent browser validation: `npm run validate:ci`
- Strongest local validation: `npm run validate:full`

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

## Manual Smoke Tests

### SSH config import — Include directive (issue #28)

The Include directive is resolved by the renderer's preprocessor calling
`termsnip_read_ssh_config_file`, which reads files under `~/.ssh/` only.

1. Create a parent config and an included file inside `~/.ssh/`:
   ```bash
   cat > ~/.ssh/parent-config <<'EOF'
   Include conf.d/work
   EOF
   mkdir -p ~/.ssh/conf.d
   cat > ~/.ssh/conf.d/work <<'EOF'
   Host smoke-include-work
     HostName work.example.com
     User deploy
   EOF
   ```
2. In the native app: Hosts → "Import SSH config" → pick `~/.ssh/parent-config`.
3. Confirm the import summary shows 1 imported host (`smoke-include-work`) and
   no `include-directive` skips.
4. Place a file outside `~/.ssh/` and reference it from a config under `~/.ssh/`
   to verify allowlist rejection:
   ```bash
   echo "Host attempted-escape" > /tmp/escape-config
   cat > ~/.ssh/escape-test <<'EOF'
   Include /tmp/escape-config
   EOF
   ```
   Importing `~/.ssh/escape-test` should yield 0 hosts and a logged
   `Include /tmp/escape-config (not found or rejected)` skip.

## Incident Handling

- If browser screens regress, start with `npm run validate:ci`.
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
