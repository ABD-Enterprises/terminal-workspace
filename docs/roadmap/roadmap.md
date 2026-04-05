# Roadmap

## Current Focus

Turn the protocol-aware host model into real native transports by launching telnet, serial, and
mosh sessions through the Tauri PTY bridge, then harden the slice with the new client preflight
layer and live runtime validation.

## Active Phases

- macOS network protocol execution
- Success criteria:
  - telnet, serial, and mosh sessions launch through the native bridge instead of stopping at inventory
  - protocol defaults and validation no longer assume SSH semantics for non-SSH hosts
  - missing telnet, mosh, screen, or cu binaries are detected before launch with inline install guidance
  - the repo test suite, desktop build, Rust tests, and runtime validator all pass

## Risks And Opportunities

- Risk: the GitHub-hosted release workflow has now been exercised live on GitHub Actions, but it is
  blocked because the required signing and notarization secrets are not configured there.
- Risk: the local workstation exposes the Developer ID identity, but it does not currently expose
  exportable certificate/password or notarization credential material, so automated GitHub secret
  provisioning cannot complete from the repo alone.
- Risk: telnet, serial, and mosh now launch through native external clients and preflight missing
  binaries before connect, but the repo still needs live runtime fixtures for those paths.
- Opportunity: the repo now has a single canonical execution contract across roadmap, shared state,
  validator enforcement, CI, agents, and prompts.
- Opportunity: the exported local vault snapshot now carries stable vault and device identifiers,
  the UI previews, merges, deletes, and governs same-vault records before apply, and remote
  envelopes now carry encrypted lineage metadata plus persisted trusted-key governance with an
  operator management/import/export surface, which gives the future sync architecture a concrete
  contract instead of a flat config dump.
- Opportunity: native local shell plus executable telnet, serial, and mosh inventory now provides
  the foundation for session history, structured runbooks, and broader multi-protocol parity work
  that pushes the desktop app toward a real Termius replacement instead of a browser demo.
- Opportunity: the hosted release workflow now has a branch-safe preview path, explicit secret
  preflight, branch-SHA release targeting, and shared Node-based secret validation, so once secret
  material is supplied it can be rerun without additional workflow design work.
- Opportunity: the workflows now use the current major releases of `actions/checkout`,
  `actions/setup-node`, `actions/upload-artifact`, and `pnpm/action-setup`, and the hosted release
  run no longer emits the Node 20 deprecation annotation.
