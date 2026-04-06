# Current Task

task_id: T1
description: Add redaction controls for persisted session output previews without broadening the current macOS session-history slice.
branch: codex/t1-session-output-redaction
pr_link: not_opened
owner: Codex
current_state: ready_for_codex
failure_type: none
acceptance_criteria_reference: /ai/acceptance.md#t1
execution_status: idle
execution_branch:
execution_started_at:
execution_heartbeat_at:
execution_lease_expires_at:
last_action: Claude reviewed T1 planning artifacts. Plan, acceptance criteria, and file scope are implementation-ready. Handing off to Codex.
next_action: Codex implements T1 on branch codex/t1-session-output-redaction, runs `npm run test -- apps/desktop/src/store/sessions-store.test.ts` and `npm --prefix ./apps/desktop run build`, then opens a GitHub PR for review.
