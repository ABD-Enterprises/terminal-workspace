# Mega Prompt

Read [/Users/deffenda/Code/term-snip/ai/bootstrap.md](/Users/deffenda/Code/term-snip/ai/bootstrap.md) first.
It is the authoritative entry point for AI-assisted work in this repo.
Use this file only as a supplemental full-execution checklist after bootstrap startup is complete.

Use this prompt when a phase requires full execution, validation, state write-back, and docs updates.

## Supplemental Flow

1. Load roadmap and shared state.
2. Select or continue the active phase branch.
3. Execute real implementation work.
4. Run validators and repo evidence commands.
5. Record build, test, run, and deploy evidence in [state/artifacts.json](/Users/deffenda/Code/term-snip/state/artifacts.json).
6. Update roadmap, state, handoff, docs, and risks.
7. Run `node ./tools/validators/enforce-runtime-guardrails.js --repo . --config ai.config.json`.
8. Do not mark a phase validated without evidence.
