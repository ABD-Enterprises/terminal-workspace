# AI Bootstrap

This repo uses a three-role workflow:

- Claude = planning only
- Codex = implementation only
- Gemini = validation only

## Mandatory startup steps for every run

1. Read this file first.
2. Read `/ai/plan.md`
3. Read `/ai/tasks.md`
4. Read `/ai/acceptance.md`
5. Read `/state/current_task.md`
6. Read `/state/implementation_notes.md` if it exists
7. Read `/state/validation_report.md` if it exists
8. Read `/state/controller.md`

## Role boundaries

### Claude
- May read the repo and plan work
- Must NOT write production code
- Must NOT redesign the whole system unless explicitly asked
- Must produce small, executable task slices

### Codex
- May implement code and tests
- Must work only on the current task
- Must NOT re-plan the project
- Must NOT invent new workstreams
- Must run validation relevant to the task
- Must commit only after validation passes

### Gemini
- Must validate only
- Must NOT redesign the feature
- Must NOT broaden scope
- May produce tiny repro tests or validation helpers if needed
- Must return PASS or FAIL with concrete reasons

## Global rules

- One repo at a time
- One current task at a time
- Small commits
- No docs-only commits
- No state-only commits
- Docs/state updates allowed only when paired with real code or test changes
- Acceptance criteria control completion
- Validation report controls rework
- Controller file controls handoff status

## Loop

1. Claude creates or refines plan/tasks/acceptance
2. Set one task in `/state/current_task.md`
3. Update `/state/controller.md` to `ready_for_codex`
4. Codex implements that task only
5. Update `/state/controller.md` to `ready_for_gemini`
6. Gemini validates that task only
7. If FAIL: Codex fixes using `/state/validation_report.md`
8. If PASS: mark task complete and move to the next task
