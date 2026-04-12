# AI Bootstrap

This repo uses one canonical autonomous PR-driven workflow:

- Claude = planning only
- Codex = implementation and fixes only
- Review = GitHub pull request, GitHub CI, and Gemini Code Assist on GitHub

GitHub is the source of truth for review and acceptance.
Repo files are the source of truth for execution state.

## Mandatory startup steps

1. Read this file first.
2. Read `/ai/plan.md`.
3. Read `/ai/tasks.md`.
4. Read `/ai/acceptance.md`.
5. Read `/state/controller.md`.
6. Read `/state/current_task.md`.
7. Read `/state/implementation_notes.md` if it exists locally.
8. Read `/state/validation_report.md` if it exists locally.

## Standards reference

This repo follows enterprise-ai-standards. The local validator runs via `scripts/validate.sh`. The authoritative standard is vendored at `project-manager/enterprise-ai-standards.md`.

## Canonical state model

`ready_for_claude -> ready_for_codex -> ready_for_review -> review_failed_fix_required -> done | blocked`

- `ready_for_claude`: planning or replanning is needed
- `ready_for_codex`: Codex must implement the current task
- `ready_for_review`: the active branch must be pushed or updated and reviewed through GitHub
- `review_failed_fix_required`: CI failed or PR review found actionable implementation issues; Codex must fix the same task
- `blocked`: work cannot continue from repo state alone
- `done`: the current task or batch satisfied GitHub review and CI

## Role boundaries

### Claude
- May read the repo and plan work
- Must not write production code
- Owns planning and replanning only

### Codex
- May implement code, tests, and CI or review fixes
- Owns all implementation, CI-failure fixes, and PR-review fixes
- Must not re-plan except by returning the repo to Claude on a planning failure

### Review
- Happens only through GitHub PRs, CI, and Gemini Code Assist on GitHub
- Is not a local/manual handoff step
- Determines pass or fail for the current task

## Review failure rule

If GitHub CI fails or PR review, including Gemini Code Assist on GitHub, identifies actionable implementation issues:

- set `/state/controller.md` and `/state/current_task.md` to `review_failed_fix_required`
- keep the same task active
- Codex owns the next step

If review reveals a planning or design problem:

- set `/state/controller.md` and `/state/current_task.md` to `ready_for_claude`
- set `failure_type: planning_failure` in `/state/current_task.md`

## Review signal rules

Review is FAILED when:

- any GitHub check fails
- required CI is not green
- actionable PR review comments remain

Review is PASSED when:

- all required GitHub checks are green
- no blocking PR review comments remain

## Workflow loop

1. Claude creates or refines `/ai/plan.md`, `/ai/tasks.md`, `/ai/acceptance.md`, and `/state/current_task.md`.
2. Claude sets `/state/controller.md` to `ready_for_codex`.
3. Codex implements the current task and may run local preflight checks before opening or updating the PR.
4. Codex sets `/state/controller.md` to `ready_for_review`, updates `/state/current_task.md`, and pushes the branch.
5. GitHub PR review, GitHub CI, and Gemini Code Assist on GitHub determine the review result.
6. If CI or review fails for implementation reasons, the repo moves to `review_failed_fix_required` and Codex fixes the same task.
7. If review exposes a planning failure, the repo moves to `ready_for_claude`.
8. If review passes, the repo moves to `done`.

## Global rules

- One repo at a time
- One current task at a time
- No agent-to-agent communication
- All coordination happens through repo files and GitHub PR state
- No docs-only commits
- No state-only commits
- Keep changes small and validated
- No competing workflow definitions
