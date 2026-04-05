# Controller State

status: ready_for_claude
current_task: T1

allowed_next:
- ready_for_claude
- ready_for_codex
- ready_for_review
- review_failed_fix_required
- blocked
- done

## Status meanings

- ready_for_claude: planning or replanning is needed
- ready_for_codex: implementation is needed for the current task
- ready_for_review: GitHub CI and PR review are needed for the current task
- review_failed_fix_required: review found implementation issues and Codex must make the smallest valid fix set
- blocked: work cannot continue without intervention
- done: current batch or run is complete

## Rules

- Only one current task at a time
- Only one status at a time
- Update this file at the end of each run
- Do not skip directly from planning to done
- Do not mark done unless the current task or batch is actually complete

## Transition rules

- Claude may move:
  - ready_for_claude -> ready_for_codex
  - ready_for_claude -> blocked

- Codex may move:
  - ready_for_codex -> ready_for_review
  - review_failed_fix_required -> ready_for_review
  - review_failed_fix_required -> ready_for_claude
  - ready_for_codex -> blocked
  - review_failed_fix_required -> blocked

- Review may move:
  - ready_for_review -> ready_for_codex
  - ready_for_review -> review_failed_fix_required
  - ready_for_review -> ready_for_claude
  - ready_for_review -> done
  - ready_for_review -> blocked

## Blocker format

blocker_owner:
blocker_reason:
blocker_file:
blocker_next_action:
