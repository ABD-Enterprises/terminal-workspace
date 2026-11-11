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
  empty map, so a damaged file cannot silently re-pin whatever answers the socket. A record that
  can only be written in part is refused rather than accepted, so a truncated key is never mistaken
  for a pin — the same rule the native store applies.
- The store refuses a path that is not a regular file — a symlink, a FIFO or a directory — rather
  than following it. The lockfile it serialises its own writers with is treated the same way: a
  lock that is not a regular file carries no holder, so it is held rather than taken.
- Release automation now prefers App Store Connect API-key auth, falls back to Apple ID auth, and
  only uses a local `notarytool` keychain profile as the final fallback.
- The Node backend refuses a request body that is not `application/json`, refuses every CORS
  preflight, and sends no `Access-Control-*` header on any response. A page the user visits can
  therefore neither send a body the backend will parse nor talk the backend into answering.
- The Node backend connects only with password or private-key authentication. A host with
  no authentication selected, or an unrecognised method, is refused before a connection opens.
- Agent forwarding is refused by the Node backend unless it was started with
  `TERMSNIP_ALLOW_AGENT_FORWARDING=1` and the request supplies the backend token. An allowed
  browser Origin alone is never enough. The environment switch adds operator approval to the
  existing token requirement.

- Native Mosh, Telnet, and serial connections refuse saved session environment overrides:
  those settings must not configure local interpreters, loaders, or executable search paths.
  SSH applies session variables on the remote side; local shell sessions deliberately support
  local environment settings. Mosh login names cannot begin with a dash, and its destination
  follows an explicit end-of-options separator.

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
- The Node backend's Origin allowlist is defence in depth, not the control that stops a
  cross-origin page: the content-type rule and the refused preflight are. A browser page that
  somehow reached an allowlisted origin would still be subject to both.
- Native mode does not use `TERMSNIP_ALLOW_AGENT_FORWARDING`. It is a different surface with a
  different threat model — only the app's own renderer can reach it — so the two are not gated the
  same way.

## Open Security Work

- Execute the CI release workflow with live repository secrets so the GitHub-hosted signing and
  notarization path is validated, not just implemented.
