# Acceptance Criteria

## Global acceptance rules
- Build passes
- Relevant tests pass
- No unrelated file churn
- No docs-only or state-only commit
- Changes stay within current task scope unless required for the fix
- GitHub PR review and CI are the only acceptance gate
- Review readiness means the branch is pushed, the PR is opened or updated, any local preflight completed, and GitHub CI plus GitHub review feedback are available
- CI failures and actionable PR comments keep the same task active under `review_failed_fix_required`
- Only planning or design failures return the repo to `ready_for_claude`

## Per-task acceptance

### T1
- `TerminalPane.tsx` exposes a pane-level output-preview persistence control
- sessions-store persistence omits `outputPreview` and related preview timestamps for panes that disable preview persistence
- sessions-store coverage proves both the default-enabled path and the opt-out path

Validation commands:
- `npm run test -- apps/desktop/src/store/sessions-store.test.ts`
- `npm --prefix ./apps/desktop run build`
- GitHub PR checks for the task branch are green
- no blocking PR review comments remain

### T2
- structured runbook starter data can exist without regressing existing snippet behavior

Validation commands:
- `npm run test`
- `npm --prefix ./apps/desktop run build`
- GitHub PR checks for the task branch are green
- no blocking PR review comments remain
