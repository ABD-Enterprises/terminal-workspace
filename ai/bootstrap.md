# AI Bootstrap

This repo uses a three-role workflow:

- Claude = planning only
- Codex = implementation only
- Review = GitHub CI + PR review + Gemini Code Assist on GitHub

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

### Review
- Review happens through GitHub CI and PR review
- Gemini Code Assist, if configured on GitHub, participates there instead of as a local handoff step
- Review feedback may send work back to Codex for fixes or Claude for replanning

## Review readiness checklist

- branch is pushed or updated
- pull request is opened or updated
- relevant local validation already passed
- GitHub CI is running or has run
- review feedback is collected from GitHub

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
3. Codex implements the task and performs local validation
4. Codex sets `/state/controller.md` to `ready_for_review`
5. The branch is pushed and the pull request is opened or updated
6. Review happens through GitHub CI and Gemini Code Assist on GitHub
7. If review finds implementation issues, set `review_failed_fix_required`
8. Codex fixes review issues and returns to `ready_for_review`
9. If review reveals a planning problem, set `ready_for_claude`
10. If review passes, set `done`
