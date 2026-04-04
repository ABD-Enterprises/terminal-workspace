# Roadmap

## Current Focus

Advance vault and sync architecture with real snapshot lineage, import preview, and conflict
classification so local-first exports stop behaving like blind full-state replacements.

## Active Phases

- Vault and sync architecture
- Success criteria:
  - local exports carry vault and snapshot ancestry metadata
  - imports preview whether the bundle is a fast-forward, divergent replacement, same snapshot, or vault adoption
  - applying an import records the imported snapshot as the local baseline
  - `npm run test` and `npm --prefix ./apps/desktop run build` pass on the active branch

## Upcoming Phases

- Live GitHub release workflow verification

## Risks And Opportunities

- Risk: the GitHub-hosted release workflow is implemented but has not yet been executed with live
  repository secrets, so CI-backed release publishing still needs one real verification pass.
- Risk: local vault imports still replace the workspace atomically. Snapshot lineage now detects
  divergent bundles, but record-level merge and conflict resolution are still unimplemented.
- Opportunity: the repo now has a single canonical execution contract across roadmap, shared state,
  validator enforcement, CI, agents, and prompts.
- Opportunity: the exported local vault snapshot now carries stable vault and device identifiers,
  and the UI now previews snapshot strategy before import, which gives the future sync architecture
  a concrete lineage contract instead of a flat config dump.
