# Current Task

task_id: T1
description: Add a pane-level output-preview persistence control so persisted session history can omit preview text for opted-out panes without losing command metadata.
branch: codex/t1-output-preview-persistence-control
pr_link: not_opened
owner: Codex
current_state: ready_for_review
failure_type: none
acceptance_criteria_reference: /ai/acceptance.md#t1
last_action: Codex added the pane-level preview persistence toggle, sanitized persisted command history for opted-out panes, and passed the targeted store test plus desktop build on the task branch.
next_action: Review the task branch on GitHub, let CI run, and return only actionable review or CI failures under the same task if needed.
