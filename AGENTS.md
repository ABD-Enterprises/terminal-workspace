# Agent Rules

Read `ai/bootstrap.md` first — it is the authoritative workflow entry point.

## Pipeline (deterministic, cron-driven)

```
Claude plans → writes ai/ → sets ready_for_codex
Codex implements → opens PR → sets ready_for_review  
CI passes → PR auto-merges (watch-open-prs)
watch-open-prs → advances state to ready_for_codex (next task)
```

State flow: `ready_for_codex` → `ready_for_review` → (merge) → `ready_for_codex` | `done`  
Failure: `review_failed_fix_required` → fix → `ready_for_review`  
Needs planning: `ready_for_claude` → Claude updates ai/ → `ready_for_codex`

## Role boundaries

**Claude** — plans tasks, writes `ai/` files, sets `ready_for_codex`. Never writes production code.  
**Codex** — implements the current task only, runs local validation, opens/updates PR. Never re-plans.  
**watch-open-prs** — merges green PRs, advances state automatically. Codex never merges its own PR.  
**No agent-to-agent communication.** Coordination happens only through repo files and PR/CI state.

## State file ownership (critical)

Codex writes: `state/current_task.md`, `state/controller.md`, `state/tasks.json`, `state/artifacts.json`, `state/implementation_notes.md`, `state/validation_report.md`, `state/handoff.json`  
Claude writes: `ai/` files, `docs/roadmap/state.json`, `ai.config.json`  
**Always commit state changes immediately** — automated readers use `git show origin/main:<file>` and will not see uncommitted local changes.

## Execution lease

Codex acquires a 90-minute lease before starting work:

- `execution_status: in_progress` + `execution_lease_expires_at` in the future → another instance is running, **STOP**
- `execution_status: in_progress` + lease expired → clear all lease fields, commit `fix: clear stale lease [task_id]`, push, then start
- Always clear the lease (set `execution_status: idle`, blank all lease fields) before setting `ready_for_review`

## Git safety

- Stage specific files only — never `git add -A` or `git add .`
- Never commit directly to `main` — use feature branches and PRs
- Run `git diff --cached --stat` before every commit to verify what is staged
- Never commit secrets, node_modules, __pycache__, .env, or generated artifacts
- Use `--force-with-lease` for own branch pushes only; never force-push `main`

## Before setting ready_for_review

1. All repo-local validation must pass (see `ai/bootstrap.md` for the exact commands)
2. `node tools/validators/enforce-runtime-guardrails.js --repo . --config ai.config.json` must pass
3. `state/artifacts.json` must reflect actual evidence (real file paths, correct statuses)
4. Lease must be cleared (`execution_status: idle`)


## Batch mode (Codex)

Codex implements **up to 3 sequential tasks per run** on one branch and one PR:

- Lease is acquired **once** at the start and covers the entire batch.
- After each task: commit the work, mark the task `done` in `state/tasks.json`, check elapsed time.
- Branch is named after the **first** task in the batch. PR title lists all completed task IDs.
- If validation fails mid-batch: commit partial work, open PR with what was done, stop (do not attempt the next task).
- `state/current_task.md` `task_id` updates to each task as the batch progresses — this is expected and correct.
- watch-open-prs is batch-aware: it finds the first `pending` task in tasks.json after all batch-completed tasks.

**Do not stop after the first task** — continue the batch loop until: 3 tasks done, 75 min elapsed, or no more pending tasks.

## Scope rules

- Work on the current task only — do not change files outside the declared scope in `ai/tasks.md`
- Never modify `ai/plan.md`, `ai/tasks.md`, `ai/acceptance.md`
- Document any necessary out-of-scope changes in `state/implementation_notes.md`
- If the task is ambiguous or blocked: set `ready_for_claude`, document reason, clear lease, stop
