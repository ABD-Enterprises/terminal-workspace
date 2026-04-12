# Controller State

current_state: ready_for_codex
current_task: T1

allowed_transitions:
- ready_for_claude -> ready_for_codex
- ready_for_claude -> blocked
- ready_for_codex -> ready_for_review
- ready_for_codex -> blocked
- ready_for_review -> review_failed_fix_required
- ready_for_review -> done
- ready_for_review -> blocked
- review_failed_fix_required -> ready_for_review
- review_failed_fix_required -> ready_for_claude
- review_failed_fix_required -> blocked

transition_rules:
- ready_for_claude -> ready_for_codex: Claude updates `/ai/plan.md`, `/ai/tasks.md`, `/ai/acceptance.md`, and `/state/current_task.md` with one executable task slice.
- ready_for_claude -> blocked: Planning cannot continue from repo state alone.
- ready_for_codex -> ready_for_review: Codex implements only the current task, updates repo state, and pushes a branch or branch update for PR review.
- ready_for_codex -> blocked: Implementation cannot continue without an external dependency or missing repo context.
- ready_for_review -> review_failed_fix_required: Any GitHub check fails, required CI is not green, or actionable PR review comments remain.
- ready_for_review -> done: All required GitHub checks are green and no blocking PR review comments remain.
- ready_for_review -> blocked: The branch or PR cannot be updated, or GitHub review cannot run.
- review_failed_fix_required -> ready_for_review: Codex fixes only CI failures or actionable review comments from the same task, reruns local preflight, and pushes an updated branch.
- review_failed_fix_required -> ready_for_claude: GitHub review proves the task needs replanning because the failure is a planning or design problem.
- review_failed_fix_required -> blocked: The required fix cannot proceed because an external blocker prevents implementation or review.

state_owner:
- ready_for_claude: Claude
- ready_for_codex: Codex
- ready_for_review: Codex
- review_failed_fix_required: Codex
- blocked: Codex
- done: Codex

done_criteria:
- `/state/current_task.md` matches the current task and records `current_state: done`
- the task pull request is open or merged and all required GitHub checks are green
- no blocking PR review comments remain

blocked_criteria:
- the branch or PR cannot be created, updated, or reviewed on GitHub
- a required external dependency or credential is unavailable
- the repo lacks enough deterministic context to continue the current task safely

blocker_owner:
blocker_reason:
blocker_file:
blocker_next_action:
