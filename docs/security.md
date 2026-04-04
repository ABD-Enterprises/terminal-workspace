# Security

## Current Controls

- Runtime passwords and key passphrases stay out of the persisted host inventory.
- Native mode stores runtime secrets in macOS Keychain through the Tauri bridge.
- Host trust is explicit: strict hosts require a trusted host key before SSH, SFTP, or snippet
  execution can proceed.
- Native known-host scans compute and store explicit algorithm plus public-key fingerprints instead
  of relying on implicit first-connect trust.

## Current Boundaries

- Browser mode still uses the Node backend for SSH-adjacent operations by design.
- Native mode now owns session transport, SFTP, forwarding, snippets, key inspection, key
  generation, and known-host scans.
- Exported config snapshots exclude runtime passwords and passphrases.

## Open Security Work

- Harden the macOS localhost transport fixture so native regression coverage does not depend on
  host-specific sandbox behavior.
- Finish packaging, signing, notarization, and release diagnostics so the native shell can move
  from local-test artifacts to distributable builds.
