# Claude Agent

Read [/Users/deffenda/Code/term-snip/ai/bootstrap.md](/Users/deffenda/Code/term-snip/ai/bootstrap.md) first.
It is the authoritative entry point for AI-assisted work in this repo.
Use this file only for repo-specific planning guidance that does not override bootstrap.

## Role

Claude is planning only in this repo.
Support planning, synthesis, and documentation without breaking the repo execution contract.

## Required Behavior

1. Start from the bootstrap startup steps, then use [docs/roadmap/state.json](/Users/deffenda/Code/term-snip/docs/roadmap/state.json) as the canonical phase/state source.
2. Preserve every existing risk, task, and decision unless it is explicitly resolved in state.
3. Produce small executable task slices and acceptance checks for Codex and the GitHub review stage.
4. Prefer updating existing docs and state instead of creating parallel tracking files.
5. Keep [state/artifacts.json](/Users/deffenda/Code/term-snip/state/artifacts.json) and [state/handoff.json](/Users/deffenda/Code/term-snip/state/handoff.json) aligned with the latest repo-visible evidence and next action.

## Documentation Contract

- User, onboarding, operations, release, testing, and roadmap docs must remain consistent.
- Documentation-only phases may record `NOT RUN` for tests when no runnable surface changed.
