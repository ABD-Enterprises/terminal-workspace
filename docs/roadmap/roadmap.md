# Roadmap

## Current Focus

Build durable session history, searchable command logs, and structured runbooks on top of the
native multi-protocol macOS client.

The first slice is now live: app-dispatched commands persist across relaunch, Sessions exposes a
searchable history rail, and saved commands can be replayed back into their host sessions.
The second slice is now live: app-dispatched command entries also retain bounded output previews,
and Sessions search can match against that saved output context.

## Active Phases

- macOS session history and structured runbooks
- Success criteria:
  - session history persists across relaunch and is searchable by host, protocol, and command text
  - structured runbooks can collect parameters, preview targets, execute safely, and retain results
  - native multi-protocol sessions emit reusable history and execution evidence
  - the repo test suite, desktop build, Rust tests, and runtime validator all pass

## Risks And Opportunities

- Risk: the GitHub-hosted release workflow has now been exercised live on GitHub Actions, but it is
  blocked because the required signing and notarization secrets are not configured there.
- Risk: the local workstation exposes the Developer ID identity, but it does not currently expose
  exportable certificate/password or notarization credential material, so automated GitHub secret
  provisioning cannot complete from the repo alone.
- Opportunity: the repo now has a single canonical execution contract across roadmap, shared state,
  validator enforcement, CI, agents, and prompts.
- Opportunity: the exported local vault snapshot now carries stable vault and device identifiers,
  the UI previews, merges, deletes, and governs same-vault records before apply, and remote
  envelopes now carry encrypted lineage metadata plus persisted trusted-key governance with an
  operator management/import/export surface, which gives the future sync architecture a concrete
  contract instead of a flat config dump.
- Opportunity: native local shell plus executable telnet, serial, and mosh inventory now has live
  PTY-backed validation coverage, which gives session history, runbooks, and broader multi-protocol
  parity work a stable native execution base instead of an inventory-only model.
- Opportunity: the first session-history slice is now user-facing, so output capture, replay,
  runbook evidence, and safer history semantics can iterate on a real persisted Sessions surface
  instead of a speculative data model.
- Risk: persisted output previews improve search and replay evidence, but they can still retain
  sensitive command results until explicit redaction and sensitivity controls exist.
- Opportunity: the hosted release workflow now has a branch-safe preview path, explicit secret
  preflight, branch-SHA release targeting, and shared Node-based secret validation, so once secret
  material is supplied it can be rerun without additional workflow design work.
- Opportunity: the workflows now use the current major releases of `actions/checkout`,
  `actions/setup-node`, `actions/upload-artifact`, and `pnpm/action-setup`, and the hosted release
  run no longer emits the Node 20 deprecation annotation.
