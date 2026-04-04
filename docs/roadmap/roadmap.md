# Roadmap

## Current Focus

Advance vault and sync architecture with user-selectable same-vault conflict resolution, then close
the remaining deletion gap so local-first imports stop behaving like destructive last-writer wins.

## Active Phases

- Vault and sync architecture
- Success criteria:
  - local exports carry vault and snapshot ancestry metadata
  - imports preview whether the bundle is a fast-forward, divergent replacement, same snapshot, or vault adoption
  - same-vault imports can merge non-conflicting records instead of replacing unrelated local state
  - same-vault conflicting records can be resolved by keeping local or preferring imported data
  - applying an import records the imported snapshot as the local baseline
  - `npm run test` and `npm --prefix ./apps/desktop run build` pass on the active branch

## Upcoming Phases

- Live GitHub release workflow verification

## Risks And Opportunities

- Risk: the GitHub-hosted release workflow is implemented but has not yet been executed with live
  repository secrets, so CI-backed release publishing still needs one real verification pass.
- Risk: same-vault imports now merge non-conflicting and conflicting records, but deletion
  semantics are still unimplemented so local-only records are retained by default.
- Opportunity: the repo now has a single canonical execution contract across roadmap, shared state,
  validator enforcement, CI, agents, and prompts.
- Opportunity: the exported local vault snapshot now carries stable vault and device identifiers,
  and the UI now previews and merges same-vault imports before apply, which gives the future sync
  architecture a concrete lineage contract instead of a flat config dump.
