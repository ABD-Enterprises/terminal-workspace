# Acceptance Criteria

## Global acceptance rules
- Build passes
- Relevant tests pass
- No unrelated file churn
- No docs-only or state-only commit
- Changes stay within current task scope unless required for the fix
- Review readiness means the branch is pushed, the PR is opened or updated, relevant local validation passed, and GitHub CI plus review feedback are available

## Per-task acceptance

### T1
- session output previews can be suppressed or redacted before persistence
- sessions-store coverage proves the redaction behavior

Validation commands:
- `npm run test -- apps/desktop/src/store/sessions-store.test.ts`
- `npm --prefix ./apps/desktop run build`

### T2
- structured runbook starter data can exist without regressing existing snippet behavior

Validation commands:
- `npm run test`
- `npm --prefix ./apps/desktop run build`
