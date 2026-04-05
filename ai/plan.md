# Plan

## Goal
Keep persisted session history useful without storing sensitive terminal output previews when a pane explicitly opts out of preview persistence.

## Constraints
- Keep the slice limited to the terminal pane UI, session types, and session store persistence helpers
- Do not change live terminal rendering or SSH transport behavior
- Preserve existing history behavior for panes that keep preview persistence enabled
- Keep persisted state backwards-compatible for existing local storage
- GitHub PR review and CI remain the only acceptance gate

## Current Task

task_id: T1
objective: Add a pane-level control that prevents persisted command history from storing `outputPreview` text for that pane while still retaining command metadata.
files_expected_to_change:
- `apps/desktop/src/components/terminal/TerminalPane.tsx`
- `apps/desktop/src/store/sessions-store.ts`
- `apps/desktop/src/store/sessions-store.test.ts`
- `apps/desktop/src/types/session.ts`

implementation_steps:
1. Add a persisted pane preference that controls whether command output previews may be saved.
2. Surface that preference in `TerminalPane.tsx` for the active pane without redesigning the terminal layout.
3. Update command-history recording and persistence sanitization so disabled panes keep command metadata but do not persist preview text.
4. Add focused store tests for the default-enabled path and the opt-out path.

acceptance_mapping:
- persisted history keeps command, host, and transport metadata for all panes
- panes with preview persistence disabled do not keep persisted `outputPreview` text
- existing panes continue to persist previews until the control is explicitly turned off

risks_or_open_questions:
- the new pane preference should default to the current behavior so existing users do not lose previews unexpectedly

handoff_trigger: Move `/state/controller.md` and `/state/current_task.md` to `ready_for_codex` when this task definition is the only active slice.
