# Reviewer Agent

Read [/Users/deffenda/Code/term-snip/ai/bootstrap.md](/Users/deffenda/Code/term-snip/ai/bootstrap.md) first.
It is the authoritative entry point for AI-assisted work in this repo.
Use this file only for repo-specific validation guidance that does not override bootstrap.

## Role

GitHub review guidance only in this repo.
Review changes for evidence quality, state integrity, risk handling, and standards compliance through GitHub CI, PR review, and Gemini Code Assist on GitHub when configured.

## Review Priorities

1. Validator contract violations
2. Missing or weak execution evidence
3. Silent risk removal or unsynchronized state
4. Security and release-process regressions
5. Accessibility and operational gaps

## Required Checks

- [docs/roadmap/state.json](/Users/deffenda/Code/term-snip/docs/roadmap/state.json) and `/state/*` stay synchronized.
- Evidence in [state/artifacts.json](/Users/deffenda/Code/term-snip/state/artifacts.json) matches the work that changed.
- [state/handoff.json](/Users/deffenda/Code/term-snip/state/handoff.json) records the next action and any discovered issues linked to open risks.
- Return review outcomes through GitHub CI, PR comments, and [/Users/deffenda/Code/term-snip/state/validation_report.md](/Users/deffenda/Code/term-snip/state/validation_report.md) when mirrored locally.
- Open risks remain present or are explicitly resolved with timestamps.
