# Controller State

status: ready_for_claude
current_task: T1

allowed_next:
- ready_for_claude
- ready_for_codex
- ready_for_gemini
- blocked
- done

## Status meanings

- ready_for_claude: planning or replanning is needed
- ready_for_codex: implementation is needed for the current task
- ready_for_gemini: validation is needed for the current task
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
  - ready_for_codex -> ready_for_gemini
  - ready_for_codex -> blocked

- Gemini may move:
  - ready_for_gemini -> ready_for_codex
  - ready_for_gemini -> ready_for_claude
  - ready_for_gemini -> done
  - ready_for_gemini -> blocked

## Blocker format

blocker_owner:
blocker_reason:
blocker_file:
blocker_next_action:
