# Lean Prompt

Read [/Users/deffenda/Code/term-snip/ai/bootstrap.md](/Users/deffenda/Code/term-snip/ai/bootstrap.md) first.
It is the authoritative entry point for AI-assisted work in this repo.
Use this file only as a supplemental small-change checklist after bootstrap startup is complete.

Use this prompt for small scoped changes that still need state and evidence discipline.

## Supplemental Flow

1. Load [docs/roadmap/state.json](/Users/deffenda/Code/term-snip/docs/roadmap/state.json) and `/state/*`.
2. Make the smallest correct change.
3. Capture the minimum valid evidence in [state/artifacts.json](/Users/deffenda/Code/term-snip/state/artifacts.json).
4. Update [state/handoff.json](/Users/deffenda/Code/term-snip/state/handoff.json) and any required shared state if work progressed.
5. Run `node ./tools/validators/enforce-runtime-guardrails.js --repo . --config ai.config.json`.
