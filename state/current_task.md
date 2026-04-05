# Current Task

task_id: T1
description: Add a pane-level output-preview persistence control so persisted session history can omit preview text for opted-out panes without losing command metadata.
branch: codex/t1-output-preview-persistence-control
pr_link: https://github.com/deffenda/term-snip/pull/1
owner: Codex
current_state: ready_for_review
failure_type: none
acceptance_criteria_reference: /ai/acceptance.md#t1
last_action: Preserved pane preview-persistence intent after pane removal, added regression coverage for removed panes, and reran the targeted store test, desktop build, lint, native check, and guardrails validation on the T1 branch.
next_action: Let GitHub PR #1 rerun review and CI on the updated `codex/t1-output-preview-persistence-control` branch.
