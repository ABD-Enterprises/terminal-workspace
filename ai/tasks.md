# Tasks

## Task List

### T1
Title: Add redaction controls for persisted session output previews
Files likely in scope:
- apps/desktop/src/components/terminal/TerminalPane.tsx
- apps/desktop/src/store/sessions-store.ts
- apps/desktop/src/store/sessions-store.test.ts
- apps/desktop/src/types/session.ts

Done when:
- the active pane exposes a control for persisted output-preview storage
- command history for opted-out panes keeps command metadata but omits persisted preview text
- the default path still persists previews until the user disables the control
- the change is covered by targeted tests
- the branch update is ready for GitHub PR review and CI

Status: ready_for_codex

---

### T2
Title: Establish structured runbook foundations without breaking snippets
Files likely in scope:
- apps/desktop/src/routes/SnippetsPage.tsx
- apps/desktop/src/components/snippets/SnippetEditor.tsx
- apps/desktop/src/store/snippets-store.ts

Done when:
- the repo has a concrete starter surface for structured runbook metadata
- the change can be reviewed through the same PR-driven workflow without broadening scope

Status: pending
