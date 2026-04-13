# Agent Rules

Read `ai/bootstrap.md` first — it is the authoritative workflow entry point.

## Pipeline (deterministic, cron-driven)

```
Claude plans → writes ai/ → sets ready_for_codex
Codex implements → opens PR + queues auto-merge → sets ready_for_review
CI passes → GitHub auto-merges PR instantly (branch protection enforces required checks)
watch-open-prs → detects merge, advances state to ready_for_codex (next task)
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

0. Rebase branch onto current main: `git fetch origin main && git rebase origin/main` — prevents DIRTY PR state.
1. All repo-local validation must pass (see `ai/bootstrap.md` for the exact commands)
2. `node tools/validators/enforce-runtime-guardrails.mjs --repo . --config ai.config.json` must pass
3. `state/artifacts.json` must reflect actual evidence (real file paths, correct statuses)
4. Lease must be cleared (`execution_status: idle`)

**If validate.sh passes locally, CI must also pass.** Local and CI validation use the same validator. A CI failure after a local pass means validate.sh is broken — fix it before opening more PRs.

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

## artifacts.json contract (validator-enforced — violations fail CI)

Valid `status` + `paths` combinations for each evidence type (`build`, `test`, `run`, `deploy`):

| status | paths | metadata_only | When to use |
|--------|-------|---------------|-------------|
| `"passed"` | non-empty array | false (omit) | Evidence captured; artifact files exist at listed paths |
| `"not_run"` | `[]` (empty) | `true` | Evidence cannot be captured in CI (macOS-only build, local-only lint, etc.) |
| `"not_required"` | `[]` (empty) | omit | This evidence type does not apply (e.g., deploy for a library) |
| `"blocked"` | `[]` (empty) | omit | Blocked by a known upstream dependency |

**Invalid combinations that WILL fail CI:**
- `"status": "passed"` + empty `paths[]` → FAIL (passed requires artifacts)
- `"status": "passed"` + `"metadata_only": true` → FAIL (double violation)
- `"status": "not_run"` + `"metadata_only": true` + type NOT in `allowed_metadata_only_evidence_types` → FAIL

**`code_changes_present`**: Set to `true` if any production code changed. Set to `false` only for state-only or docs-only commits.

**Always run the validator BEFORE writing artifacts.json.** Never pre-populate artifacts.json with CI tracking fields — the validator writes those. If `scripts/validate.sh` writes artifacts.json before calling the validator, that is a bug.

## Validator integrity (enterprise standard — do not modify)

`tools/validators/enforce-runtime-guardrails.mjs` is synced from enterprise-ai-standards and must not be modified in this repo. The file is hash-verified by CI before execution. Modifications will cause CI to fail immediately with an integrity error.

To update the validator: submit a change to enterprise-ai-standards and run the sync script.
