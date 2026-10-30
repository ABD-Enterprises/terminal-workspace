# Security

## Current Controls

- Runtime passwords and key passphrases stay out of the persisted host inventory.
- Native mode stores runtime secrets in macOS Keychain through the Tauri bridge.
- Host trust is explicit: strict hosts require a trusted host key before SSH, SFTP, or snippet
  execution can proceed.
- Native known-host scans compute and store explicit algorithm plus public-key fingerprints instead
  of relying on implicit first-connect trust.
- Browser mode verifies SSH host keys too. A host with no explicitly trusted key is pinned on first
  sight into a durable `known_hosts` store, and a host whose key later changes is refused before any
  credential is sent. The store is the same OpenSSH-shaped file the native transport uses
  (`<app data dir>/ssh/known_hosts`), so a host trusted in one mode is trusted in the other.
- The host-key store is append-only and fails closed: a malformed store is an error rather than an
  empty map, so a damaged file cannot silently re-pin whatever answers the socket.
- Release automation now prefers App Store Connect API-key auth, falls back to Apple ID auth, and
  only uses a local `notarytool` keychain profile as the final fallback.

## Current Boundaries

- Browser mode still uses the Node backend for SSH-adjacent operations by design.
- Browser mode and native mode cannot exclude one another from the host-key store: the native
  store serialises its writers with an `flock`, which Node cannot take, so the Node backend
  serialises its own writers with a separate lockfile instead. Two writers meeting the same
  unpinned host at the same moment can both record it.
- Native mode now owns session transport, SFTP, forwarding, snippets, key inspection, key
  generation, and known-host scans.
- Exported config snapshots exclude runtime passwords and passphrases.
- Exported vault snapshots include shared vault identifiers but keep runtime secrets outside the
  persisted snapshot format.

## Open Security Work

- Execute the CI release workflow with live repository secrets so the GitHub-hosted signing and
  notarization path is validated, not just implemented.
