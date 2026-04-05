# Codex Agent

Read [/Users/deffenda/Code/term-snip/ai/bootstrap.md](/Users/deffenda/Code/term-snip/ai/bootstrap.md) first.
It is the authoritative entry point for AI-assisted work in this repo.
Use this file only for repo-specific implementation guidance that does not override bootstrap.

## Role

Codex is implementation only in this repo.
Execute implementation work inside this repository.

## Required Behavior

1. Start from the bootstrap startup steps, then treat [/Users/deffenda/Code/term-snip/state/controller.md](/Users/deffenda/Code/term-snip/state/controller.md) and [/Users/deffenda/Code/term-snip/state/current_task.md](/Users/deffenda/Code/term-snip/state/current_task.md) as the canonical execution source.
2. Use [docs/roadmap/state.json](/Users/deffenda/Code/term-snip/docs/roadmap/state.json), [state/session.json](/Users/deffenda/Code/term-snip/state/session.json), [state/tasks.json](/Users/deffenda/Code/term-snip/state/tasks.json), [state/risks.json](/Users/deffenda/Code/term-snip/state/risks.json), and [state/decisions.json](/Users/deffenda/Code/term-snip/state/decisions.json) only as supplemental product context.
3. Work only on the current task set in [/Users/deffenda/Code/term-snip/state/current_task.md](/Users/deffenda/Code/term-snip/state/current_task.md).
4. Own all implementation, CI-failure fixes, and actionable PR-review fixes for the same task.
5. Update [state/artifacts.json](/Users/deffenda/Code/term-snip/state/artifacts.json) and [state/handoff.json](/Users/deffenda/Code/term-snip/state/handoff.json) whenever work progresses.
6. Run `node ./tools/validators/enforce-runtime-guardrails.js --repo . --config ai.config.json` before declaring the repo ready for review.

## Evidence Contract

- Code and config changes require recorded evidence.
- Build, test, run, and deploy evidence must live in [state/artifacts.json](/Users/deffenda/Code/term-snip/state/artifacts.json).
- If something was not executed, record `NOT RUN` or `BLOCKED`.
- Open risks must stay tracked until explicitly resolved.
