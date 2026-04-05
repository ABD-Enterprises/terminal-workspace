# Deploy Prompt

Read [/Users/deffenda/Code/term-snip/ai/bootstrap.md](/Users/deffenda/Code/term-snip/ai/bootstrap.md) first.
It is the authoritative entry point for AI-assisted work in this repo.
Use this file only as a supplemental deployment checklist after bootstrap startup is complete.

Use this prompt for release or deployment phases.

## Supplemental Flow

1. Confirm the phase is deployment-oriented in roadmap state.
2. Execute release or deployment commands for real.
3. Record deployment evidence in [state/artifacts.json](/Users/deffenda/Code/term-snip/state/artifacts.json).
4. Update deployment and promotion history in [docs/roadmap/state.json](/Users/deffenda/Code/term-snip/docs/roadmap/state.json).
5. Update [state/handoff.json](/Users/deffenda/Code/term-snip/state/handoff.json) with the next action and any discovered issues.
6. Run `node ./tools/validators/enforce-runtime-guardrails.js --repo . --config ai.config.json`.
