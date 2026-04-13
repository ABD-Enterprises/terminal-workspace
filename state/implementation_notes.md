# Implementation Notes

- 2026-04-12 reclaim: reused existing task branch `codex/t1-output-preview-persistence-control` and PR #1 after confirming there was no active execution lease in `state/current_task.md`.

- 2026-04-05: Validated the existing T1 working-tree changes that add a pane-level `persistOutputPreview` preference, redact persisted preview fields for opted-out panes, and cover the default-enabled plus opt-out store paths.

Local preflight:
- `npm run test -- apps/desktop/src/store/sessions-store.test.ts`
- `npm --prefix ./apps/desktop run build`

- 2026-04-05 review-fix pass: preserved each command-history entry's preview-persistence intent after pane removal, added pane-removal regression coverage, and cleared the active lint and guardrails failures in the working tree.

Additional local preflight:
- `npm run lint`
- `npm run validate:guardrails`

- 2026-04-05 review-fix pass: refreshed the guardrails evidence bundle for PR #1, corrected `state/artifacts.json` so the diff metadata matches the branch's code changes, and reran the validator against `origin/main`.

Additional local preflight:
- `AI_VALIDATOR_BASE_REF=origin/main npm run validate:guardrails`
