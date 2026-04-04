# Roadmap

## Current Focus

Bootstrap the repository into a validator-enforced execution system with canonical roadmap/state
tracking, agent and prompt contracts, and pull-request guardrails.

## Active Phases

- Bootstrap
- Success criteria:
  - `tools/validators/enforce-runtime-guardrails.js` exists and enforces roadmap/state/evidence rules
  - `.github/workflows/ci.yml` runs the validator on pull requests
  - canonical roadmap/state files remain synchronized
  - repo test and build evidence are recorded for the bootstrap branch

## Upcoming Phases

- Vault and sync architecture
- Live GitHub release workflow verification

## Risks And Opportunities

- Risk: the GitHub-hosted release workflow is implemented but has not yet been executed with live
  repository secrets, so CI-backed release publishing still needs one real verification pass.
- Opportunity: the repo now has a single canonical execution contract across roadmap, shared state,
  validator enforcement, CI, agents, and prompts.
- Opportunity: the exported local vault snapshot now carries stable vault and device identifiers,
  which gives the future sync architecture a concrete metadata contract instead of a flat config dump.
