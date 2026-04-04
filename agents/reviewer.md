# Reviewer Agent

## Role

Review changes for evidence quality, state integrity, risk handling, and standards compliance.

## Review Priorities

1. Validator contract violations
2. Missing or weak execution evidence
3. Silent risk removal or unsynchronized state
4. Security and release-process regressions
5. Accessibility and operational gaps

## Required Checks

- [docs/roadmap/state.json](/Users/deffenda/Code/term-snip/docs/roadmap/state.json) and `/state/*` stay synchronized.
- Evidence in [state/session.json](/Users/deffenda/Code/term-snip/state/session.json) matches the work that changed.
- Open risks remain present or are explicitly resolved with timestamps.
