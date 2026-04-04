# Roadmap

## Current Focus

Build the first solo-macOS daily-driver slice: protocol-aware hosts, a real native local shell
session path, and SSH-only guardrails so SFTP, trust, snippets, and forwards stay constrained to
supported transports while the rest of the protocol matrix is staged behind explicit follow-up work.

## Active Phases

- macOS solo protocols and local shell
- Success criteria:
  - hosts carry explicit protocol metadata without regressing existing SSH inventory, sync, or import flows
  - the native shell can open a real local login-shell session through the Tauri bridge
  - SSH-only features stay hidden or disabled for non-SSH protocols
  - the repo test suite, desktop build, Rust tests, and runtime validator all pass

## Risks And Opportunities

- Risk: the GitHub-hosted release workflow has now been exercised live on GitHub Actions, but it is
  blocked because the required signing and notarization secrets are not configured there.
- Risk: the local workstation exposes the Developer ID identity, but it does not currently expose
  exportable certificate/password or notarization credential material, so automated GitHub secret
  provisioning cannot complete from the repo alone.
- Risk: telnet, serial, and mosh now exist in the host model, but they are still inventory-only and
  not executable through the native runtime yet.
- Opportunity: the repo now has a single canonical execution contract across roadmap, shared state,
  validator enforcement, CI, agents, and prompts.
- Opportunity: the exported local vault snapshot now carries stable vault and device identifiers,
  the UI previews, merges, deletes, and governs same-vault records before apply, and remote
  envelopes now carry encrypted lineage metadata plus persisted trusted-key governance with an
  operator management/import/export surface, which gives the future sync architecture a concrete
  contract instead of a flat config dump.
- Opportunity: native local shell plus protocol-aware host inventory now provides the foundation for
  local terminal, runbook, session history, and multi-protocol parity work that pushes the desktop
  app toward a real Termius replacement instead of a browser demo.
- Opportunity: the hosted release workflow now has a branch-safe preview path, explicit secret
  preflight, branch-SHA release targeting, and shared Node-based secret validation, so once secret
  material is supplied it can be rerun without additional workflow design work.
- Opportunity: the workflows now use the current major releases of `actions/checkout`,
  `actions/setup-node`, `actions/upload-artifact`, and `pnpm/action-setup`, and the hosted release
  run no longer emits the Node 20 deprecation annotation.
