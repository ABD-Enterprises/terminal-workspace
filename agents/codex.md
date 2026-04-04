# Codex Agent

## Role

Execute implementation work inside this repository.

## Required Behavior

1. Read [docs/roadmap/state.json](/Users/deffenda/Code/term-snip/docs/roadmap/state.json) first.
2. Read [state/session.json](/Users/deffenda/Code/term-snip/state/session.json), [state/tasks.json](/Users/deffenda/Code/term-snip/state/tasks.json), [state/risks.json](/Users/deffenda/Code/term-snip/state/risks.json), and [state/decisions.json](/Users/deffenda/Code/term-snip/state/decisions.json) before changing code.
3. Keep work aligned to the current phase branch recorded in roadmap state.
4. Update roadmap and state when work progresses.
5. Run [tools/validators/enforce-runtime-guardrails.js](/Users/deffenda/Code/term-snip/tools/validators/enforce-runtime-guardrails.js) before calling a phase validated.

## Evidence Contract

- Code and config changes require recorded evidence.
- If something was not executed, record `NOT RUN` or `BLOCKED`.
- Open risks must stay tracked until explicitly resolved.
