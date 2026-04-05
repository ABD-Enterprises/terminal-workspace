# Security

## Current Controls

- Runtime passwords and key passphrases stay out of the persisted host inventory.
- Native mode stores runtime secrets in macOS Keychain through the Tauri bridge.
- Host trust is explicit: strict hosts require a trusted host key before SSH, SFTP, or snippet
  execution can proceed.
- Native known-host scans compute and store explicit algorithm plus public-key fingerprints instead
  of relying on implicit first-connect trust.
- Release automation now prefers App Store Connect API-key auth, falls back to Apple ID auth, and
  only uses a local `notarytool` keychain profile as the final fallback.

## Current Boundaries

- Browser mode still uses the Node backend for SSH-adjacent operations by design.
- Native mode now owns session transport, SFTP, forwarding, snippets, key inspection, key
  generation, and known-host scans.
- Exported config snapshots exclude runtime passwords and passphrases.
- Exported vault snapshots include shared vault identifiers but keep runtime secrets outside the
  persisted snapshot format.

## Open Security Work

- Execute the CI release workflow with live repository secrets so the GitHub-hosted signing and
  notarization path is validated, not just implemented.
