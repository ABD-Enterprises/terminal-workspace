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
- The Node backend refuses a request body that is not `application/json`, refuses every CORS
  preflight, and sends no `Access-Control-*` header on any response. A page the user visits can
  therefore neither send a body the backend will parse nor talk the backend into answering.
- The Node backend acts only on the three authentication methods the host type defines
  (`none`, `password`, `privateKey`). An unrecognised value is refused rather than carried into the
  SSH configuration.
- Agent forwarding is refused by the Node backend unless it was started with
  `TERMSNIP_ALLOW_AGENT_FORWARDING=1`. The host record that asks for it arrives in the request
  body, so the authorisation has to come from the operator who started the backend, not from the
  caller.

## Current Boundaries

- Browser mode still uses the Node backend for SSH-adjacent operations by design.
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
