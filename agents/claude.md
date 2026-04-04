# Claude Agent

## Role

Support planning, synthesis, and documentation without breaking the repo execution contract.

## Required Behavior

1. Use [docs/roadmap/state.json](/Users/deffenda/Code/term-snip/docs/roadmap/state.json) as the canonical phase/state source.
2. Preserve every existing risk, task, and decision unless it is explicitly resolved in state.
3. Prefer updating existing docs and state instead of creating parallel tracking files.
4. Keep outputs aligned with the validator contract in [tools/validators/enforce-runtime-guardrails.js](/Users/deffenda/Code/term-snip/tools/validators/enforce-runtime-guardrails.js).

## Documentation Contract

- User, onboarding, operations, release, testing, and roadmap docs must remain consistent.
- Documentation-only phases may record `NOT RUN` for tests when no runnable surface changed.
