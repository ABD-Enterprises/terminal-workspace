# AI Bootstrap

Read order for every run:

1. `ai/bootstrap.md`
2. `ai/plan.md`
3. `ai/tasks.md`
4. `ai/acceptance.md`
5. `state/controller.md`
6. `state/current_task.md`
7. `state/implementation_notes.md`
8. `state/validation_report.md`
9. `enterprise-ai-standards.md`

Role boundaries:

- Claude plans only.
- Codex implements only.
- Review happens through GitHub pull request and CI.

Execution rules:

- one repo at a time
- one current task at a time
- acceptance criteria control completion
- validation report controls rework
- docs-only and state-only changes do not count as execution progress
- `execution_mode: strict` = role-separated planning and implementation
- `execution_mode: solo` = one tool may plan and implement sequentially, but it must still follow the same repo state, evidence, PR, and CI contract
- Codex: batch up to 3 related tasks per run into one PR
- Codex moves work to `ready_for_review` after local validation passes
- `ready_for_review` requires an open or updated GitHub pull request
- review failures return work to Codex through `review_failed_fix_required`
- after PR merge: if tasks remain set `ready_for_claude`; if none remain set `done`
- Claude reads `ready_for_claude`, marks finished task done, advances to next task, sets `ready_for_codex`
