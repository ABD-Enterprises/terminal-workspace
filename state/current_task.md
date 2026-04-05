# Current Task

task_id: T1
description: Add a pane-level output-preview persistence control so persisted session history can omit preview text for opted-out panes without losing command metadata.
branch: codex/t1-output-preview-persistence-control
pr_link: https://github.com/deffenda/term-snip/pull/1
owner: Codex
current_state: ready_for_review
failure_type: none
acceptance_criteria_reference: /ai/acceptance.md#t1
last_action: Stabilized the Transfers route by removing the filtered Zustand selector crash, added an SSH control-session readiness check before native SFTP batch commands, reran the failing Playwright specs, and passed the default Rust test suite while the ignored localhost fixture still reached the later local-forward sandbox limit locally.
next_action: Let GitHub PR #1 rerun `validate` and `native-macos` on the updated `codex/t1-output-preview-persistence-control` branch.
