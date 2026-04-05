# Current Task

task_id: T1
description: Add a pane-level output-preview persistence control so persisted session history can omit preview text for opted-out panes without losing command metadata.
branch: codex/t1-output-preview-persistence-control
pr_link: https://github.com/deffenda/term-snip/pull/1
owner: Codex
current_state: ready_for_review
failure_type: none
acceptance_criteria_reference: /ai/acceptance.md#t1
last_action: Refreshed the guardrails evidence and state files for the current rerun commit, corrected the diff flag in `state/artifacts.json`, and reran the guardrails validator against `origin/main`.
next_action: Push `codex/t1-output-preview-persistence-control` and wait for PR #1 validation plus review to rerun.
