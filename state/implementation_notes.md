# Implementation Notes

- 2026-04-13 planning-failure triage: PR #3 review exposed a task-contract contradiction that Codex cannot resolve without changing planning artifacts. `ai/tasks.md` requires `Cmd+Tab` session cycling for S1, but review correctly flagged that shortcut as conflicting with the macOS app switcher. `ai/acceptance.md` also does not define a `### S1` section, so the active task has no canonical acceptance contract. Returned the repo to `ready_for_claude` for replanning instead of forcing a code change that would violate the current spec.

Active task IDs: `S1`

CHANGED
- Added tab-cycling support in the sessions store and wired `Cmd+Tab` / `Shift+Cmd+Tab` session switching in the desktop shell.
- Added a compact left-rail session table with hostname, plain-text status, and duration for direct tab switching.
- Added automatic reconnect scheduling in `TerminalPane` for unexpected SSH transport drops.

DID
- Implemented the current `S1` branch changes without touching planning files.
- Kept credential storage on the existing native secrets/keychain path.

VALIDATED
- `npx eslint apps/desktop/src/components/layout/AppShell.tsx apps/desktop/src/components/layout/Sidebar.tsx apps/desktop/src/components/terminal/TerminalPane.tsx apps/desktop/src/lib/utils.ts apps/desktop/src/store/sessions-store.ts apps/desktop/src/store/sessions-store.test.ts`
- `npm run test -- apps/desktop/src/store/sessions-store.test.ts`
- `npm --prefix ./apps/desktop run build`

NEXT
- Claude must replace the `Cmd+Tab` shortcut requirement with a review-safe in-app shortcut contract and add a canonical `### S1` acceptance section before handing the task back to Codex.
- Repo-wide `npm run lint` still reports pre-existing errors in `tools/validators/enforce-runtime-guardrails.js`, outside this task diff.
