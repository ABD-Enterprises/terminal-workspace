# Enterprise AI Standards

This is the single authoritative standards document for downstream AI-driven delivery repos.

Authoritative paths:

- standards: `project-manager/enterprise-ai-standards.md`
- validator: `tools/validators/enforce-runtime-guardrails.js`
- config template: `templates/ai.config.json`
- adoption template: `templates/product-repo-minimal/`

Everything else in this repository is supporting guidance, examples, or templates.

## 1. Layer Boundaries

These layers are intentionally separate. Product repos must not collapse them together.

### LB-1 Environment Layer: BrewSync

BrewSync is the machine-state engine.

It owns:

- machine packages
- developer tools
- runtime toolchains
- environment manifests such as `brew/*.txt`
- environment operations: `plan`, `inventory`, `drift`, `apply`, `verify`

It does not own:

- product roadmap
- tasks
- risks
- application logic
- CI/CD state
- execution evidence state

### LB-2 Execution Layer: Product Repo

The product repo is the execution source of truth.

It owns:

- roadmap
- `docs/roadmap/state.json`
- `state/`
- code
- tests
- evidence
- local and CI execution of agents and validators

### LB-3 Enforcement Layer: enterprise-ai-standards

This repository is the enforcement layer.

It owns:

- delivery contracts
- validator behavior
- evidence, state, and risk enforcement rules
- adoption templates

It does not own:

- business logic
- application releases
- environment mutations
- product repo state

### LB-4 Control Layer: Future orchestration and visibility

The future control layer is optional.

It may:

- read repo state
- visualize runs, drift, and progress
- trigger actions

It must not:

- become required for local execution
- own execution state
- replace product repo state as the source of truth

## 2. Layer Contracts

### LC-1 Environment rules

- Environment state must not be inferred from product repo state.
- BrewSync outputs are external inputs, not owned execution state.
- BrewSync internals must not be required by the validator.
- Protected environment-layer paths are explicit validator inputs. `brew/` is protected by default.
- Execution repos do not own protected environment-layer state or files.

### LC-2 Execution rules

- The product repo is authoritative for roadmap, tasks, risks, decisions, evidence, and handoff state.
- Missing execution state must not be substituted by machine assumptions or external services.
- Agents and CI must read repo-visible state directly.

### LC-3 Enforcement rules

- The validator operates only on repo-visible state, repo-visible artifacts, and the current repo diff.
- The validator must not require BrewSync, the control layer, network calls, or any other external system.
- External logs or verification outputs only count when attached to the repo as referenced artifacts.

## 3. Three-Role Repo Execution Model

### TM-1 Role model

Three-role workflow:

- Claude = planning only
- Codex = implementation only
- Review = GitHub pull request + CI + Gemini Code Assist on GitHub

Claude updates planning artifacts only.
Codex implements only the current task.
Review determines whether work is accepted, needs fixes, needs replanning, or is blocked.

Role ownership:

- Claude owns planning and replanning only.
- Codex owns implementation and review remediation by default.
- Claude re-enters only when review reveals a requirement, scope, or design problem.

### TM-2 Handoff model

Agents hand off through repo files, not chat memory.

Mandatory startup expectations for every run:

1. Read `ai/bootstrap.md` first.
2. Read `ai/plan.md`, `ai/tasks.md`, and `ai/acceptance.md`.
3. Read `state/controller.md` and `state/current_task.md`.
4. Read `state/implementation_notes.md` and `state/validation_report.md` if present.
5. Apply the latest standards, including night mode if enabled.

Official controller states:

- `ready_for_claude`
- `ready_for_codex`
- `ready_for_review`
- `review_failed_fix_required`
- `blocked`
- `done`

State meanings:

- `ready_for_claude` = current task is finished and Claude should mark it done, select the next task, and advance to `ready_for_codex`; OR planning or replanning is needed
- `ready_for_codex` = current task is queued and ready for Codex to implement
- `ready_for_review` = branch should be pushed or updated and reviewed through GitHub PR + CI + Gemini Code Assist on GitHub
- `review_failed_fix_required` = review found implementation issues that Codex should fix
- `blocked` = work cannot continue without intervention
- `done` = no remaining tasks in the current backlog; triggers Claude to check for a roadmap or backlog source and plan the next batch
- `blocked` after 3 consecutive `review_failed_fix_required` cycles on the same task = automatic circuit breaker

Post-merge state selection:

- If tasks remain in `ai/tasks.md` with status `pending`, set controller to `ready_for_claude` so Claude can mark the finished task done and advance to the next task.
- If no tasks remain (all tasks are `done`), set controller to `done`.

Done-state replanning:

- When Claude reads `done`, it checks for a roadmap or backlog source (e.g., `docs/roadmap.md`, `docs/roadmap/state.json`, GitHub issues, or `CHANGELOG.md` gap analysis).
- If planned work exists, Claude produces a new `ai/plan.md`, `ai/tasks.md`, and `ai/acceptance.md`, then sets controller to `ready_for_codex`.
- If no further work is identified, the controller stays `done` and a summary notification is produced.

Review failure circuit breaker:

- If the same task has been in `review_failed_fix_required` for 3 consecutive cycles without advancing to a merged PR, the automation must set the controller to `blocked` with a note explaining the repeated failure.
- Blocked tasks require human intervention or Claude replanning before resuming.

Execution lease:

- Codex-owned execution must use a repo-visible lease recorded in `state/current_task.md`.
- Required lease fields are `execution_status`, `execution_branch`, `execution_started_at`, `execution_heartbeat_at`, and `execution_lease_expires_at`.
- `execution_status = in_progress` with a future `execution_lease_expires_at` means another Codex run must not start or remediate the same task.
- If the lease is expired, the next Codex run may reclaim the same task on the same branch and must record that reclaim in `state/implementation_notes.md`.
- Branch existence and PR existence checks are required as defense in depth even when a lease is present or stale.

Lease-aware stale detection:

- Planner, summary, and triage automations must not classify a repo as stale while `execution_lease_expires_at` is in the future.
- A repo may be classified as stale only when there has been no repo-visible progress for more than 2 hours and there is no fresh execution lease.
- Repo-visible progress includes commits, PR updates, or state/notes updates for the current task.
- Stale classification is advisory for replanning and attention routing. It does not authorize a second Codex session while a fresh lease exists.

Two-pass review:

- Pass 1 is the PR-driven review stage: CI, blocking review comments, unresolved review threads, and merge acceptance.
- Pass 2 is a planner-owned hardening review after merged acceptance or `ready_for_claude`.
- Pass 2 reads the actual delivered change and looks for residual gaps in error handling, resilience, validation, observability, security, performance, and test coverage.
- Pass 2 findings must be grouped into a single follow-up hardening task unless separate tasks are genuinely required.
- Pass 2 does not retroactively fail a merged task unless acceptance criteria or correctness were actually missed.

`ready_for_review` requires an actual pull request in GitHub.
This standards repo defines that rule.
Each participating product repo must enforce the live PR existence check in repo-local CI or automation because GitHub branch, repository, and default-branch context are repo-specific.

### TM-3 Global operating rules

- one repo at a time
- one current task at a time
- small commits
- acceptance criteria control completion
- validation report controls pass/fail and rework
- execution commits by Codex must include real code or test changes
- docs-only and state-only changes do not count as execution progress
- docs/state changes are allowed only when paired with real code or test changes, except Claude planning artifact refreshes which remain planning-only and must not be presented as implementation progress or completion
- review remediation is a normal Codex implementation cycle, not a separate workflow role
- automation ownership should be exclusive by controller state so the same state is not advanced by competing loops

### TM-4 Execution loop

1. Claude creates or refines `ai/plan.md`, `ai/tasks.md`, and `ai/acceptance.md`.
2. One task is set in `state/current_task.md`.
3. Codex implements that task and performs local validation.
4. Codex sets `state/controller.md` to `ready_for_review`.
5. The branch is pushed and the pull request is opened or updated.
6. GitHub CI and Gemini Code Assist on GitHub review the pull request.
7. If review finds implementation issues, set `state/controller.md` to `review_failed_fix_required`.
8. Codex fixes review issues, reruns local validation, pushes updates to the same branch, and returns the controller to `ready_for_review`.
9. If review reveals a planning problem, set `state/controller.md` to `ready_for_claude`.
10. If review passes and the pull request is merged:
    - If tasks remain in `ai/tasks.md` with status `pending`, set `state/controller.md` to `ready_for_claude`.
    - If no tasks remain, mark the current task done and set `state/controller.md` to `done`.
    - Claude reads `ready_for_claude`, marks the finished task `done`, performs the pass-2 hardening review, advances `state/current_task.md` to the next task, and sets `state/controller.md` to `ready_for_codex`.

### TM-5 Required repo structure contract

Repos participating in this workflow must provide these repo-visible files:

- `ai/bootstrap.md`
- `ai/plan.md`
- `ai/tasks.md`
- `ai/acceptance.md`
- `state/controller.md`
- `state/current_task.md`
- `state/implementation_notes.md`
- `state/validation_report.md`

These files are required execution-contract inputs, not optional chat supplements.

### TM-6 File purpose contract

`ai/bootstrap.md`

- mandatory first-read file
- tells each model what to load
- defines role boundaries
- defines the PR-driven review stage

`ai/plan.md`

- high-level plan
- narrow project or phase goal
- constraints and approach

`ai/tasks.md`

- small executable tasks
- likely files in scope
- `done_when` criteria
- status

`ai/acceptance.md`

- explicit acceptance checks
- local validation commands Codex should run
- pull request and CI checks the review stage should evaluate
- task-specific completion criteria

`state/controller.md`

- current workflow state
- next owner
- review routing
- blocker or replan signal when needed
- PR review readiness state when `ready_for_review` is set
- post-merge closure when the current task reaches `done`

`state/current_task.md`

- exactly one active task
- exact scope
- role restrictions
- mark the task done only after merged review acceptance
- execution lease fields for Codex re-entry control

`state/implementation_notes.md`

- written by Codex
- files changed
- what changed
- local validation run
- commit
- pull request or merge closure note when review acceptance completes the task
- remaining issues

`state/validation_report.md`

- written from GitHub PR review, CI, and Gemini Code Assist on GitHub outcomes
- PASS or FAIL
- checks performed
- commands run
- defects found
- exact fix requests
- merge acceptance or closure outcome when the review stage completes

### TM-7 Output contract

Claude required output:

- updated planning artifacts only

Codex required output:

- `CHANGED`
- `DID`
- `VALIDATED`
- `NEXT`

Review required output:

- `PASS` or `FAIL`
- exact checks performed
- exact commands run
- exact defects found
- exact fix requests

### TM-9 PR review enforcement guidance

This repo is the authoritative source for the PR review rule.

Required policy:

- `ready_for_review` means the branch must have an open or updated GitHub pull request
- PR review is the official review and validation stage
- work must not be treated as review-ready if no PR exists
- merged PR acceptance is the event that closes the current task as `done`

Required enforcement split:

- this repo defines the rule and reusable enforcement guidance
- each product repo enforces actual PR existence in its own CI or automation

Reason:

- GitHub repository identity, branch naming, and default-branch targeting are product-repo specific
- live PR existence cannot be authoritatively inferred here without repo-specific GitHub context

### TM-10 Automation-driven execution guidance

Automation-driven repos may use Codex automations to advance controller states.

Required automation behavior:

- one automation may own `ready_for_codex` ("Get Next Planned Tasks")
- one automation may own `ready_for_review` and `review_failed_fix_required` ("Address Open PRs")
- the review watcher may merge the pull request when review acceptance criteria are satisfied
- after merge, the automation should set `state/controller.md` to `ready_for_claude` if tasks remain, or `done` if no tasks remain
- Claude (scheduled or triggered) reads `ready_for_claude`, marks the finished task done, advances `state/current_task.md` to the next pending task, and sets `state/controller.md` to `ready_for_codex`
- Claude (scheduled or triggered) reads `done`, checks for a roadmap or backlog source, and either plans the next batch or stays done
- the next task must not move to `ready_for_codex` until Claude has selected and queued it
- before any Codex-owned run starts work, it must check for an active execution lease plus existing branch and pull request state
- a fresh execution lease must block re-entry by any Codex automation on the same repo and task
- Codex must refresh `execution_heartbeat_at` and `execution_lease_expires_at` during long-running work
- Codex must clear the execution lease when the task moves to `ready_for_review`, `ready_for_claude`, `blocked`, or `done`
- stale execution leases may be reclaimed only on the same task branch, with the reclaim recorded in `state/implementation_notes.md`
- planner and summary automations must use the 2-hour, lease-aware stale rule before flagging a repo as stuck or stale
- pass-2 hardening review must create one grouped hardening follow-up task when residual gaps are found
- repo-scanning automations must treat repo-local unsafe conditions such as dirty worktrees, fresh execution leases, or unmet task dependencies as skip conditions for that repo, not as a global stop for the full scan

Scope guard:

- Codex automations must NOT modify `ai/plan.md`, `ai/tasks.md`, or `ai/acceptance.md`
- Only Claude may create or update planning artifacts
- Codex may update `state/controller.md`, `state/current_task.md`, `state/implementation_notes.md`, and `state/validation_report.md`
- Codex may update `state/tasks.json`, `state/artifacts.json`, `state/handoff.json`, and `state/decisions.json` when those files exist

Review failure circuit breaker:

- If the same task has been in `review_failed_fix_required` for 3 consecutive cycles, the automation must set the controller to `blocked`
- The blocked note must include the failure count and the last CI or review error summary
- Blocked tasks require human intervention or Claude replanning before resuming

### TM-8 Night mode policy

Bounded unattended execution is allowed through `run_profile = night`.

Night mode rules:

- one repo at a time
- narrow task slices only
- no broad architecture work
- no docs-only or state-only progress loops
- validation must still occur
- concrete blockers must be recorded and the run must stop or follow repo policy
- review still happens through GitHub pull request, CI, and Gemini Code Assist on GitHub

One-line summary: Night run mode = code/test change + targeted validation + commit, with minimal governance churn.

## 4. Execution Contract

These rules are mandatory and machine-enforced where possible.

Execution profiles are config-driven:

- `standard`
- `night`

Default: `standard`

### EX-1 Required shared state

Every adopting repo must track these files:

- `docs/roadmap/state.json`
- `state/tasks.json`
- `state/risks.json`
- `state/decisions.json`
- `state/artifacts.json`
- `state/handoff.json`

### EX-2 State load before work

Every material run must treat the files above as the repo source of truth for:

- current phase
- current task
- unresolved risks
- recorded decisions
- current evidence
- handoff continuity

### EX-3 Standard profile progress updates

If a diff contains non-state work, the same diff must also update:

- `state/tasks.json`
- `state/artifacts.json`
- `state/handoff.json`

### EX-4 Night profile progress updates

`run_profile = night` is for unattended overnight repo progress.

One-line summary: Night run mode = code/test change + targeted validation + commit, with minimal governance churn.

It is intentionally narrow:

- small code or test changes
- targeted validation
- evidence-backed commits
- minimal governance churn

In `night` profile, a non-doc code or test diff must still update:

- `state/artifacts.json`

In `night` profile, these files are not required on every code or test diff unless the actual work needs them:

- `state/tasks.json`
- `state/handoff.json`
- `state/risks.json`

Night profile does not relax:

- evidence requirements
- risk continuity
- phase completion gates
- phase-change state updates
- layer boundaries

Night profile must not be used for:

- docs-only work
- state-only work
- governance-only work
- architecture changes
- broad refactors

### EX-5 Phase changes require state updates

If `current_phase`, `phase_type`, or `phase_status` changes in `docs/roadmap/state.json`, at least one of these files must also change in the same diff:

- `state/tasks.json`
- `state/artifacts.json`
- `state/handoff.json`
- `state/risks.json`

### EX-6 No false completion

A phase may only be marked `complete` when the required evidence for that phase is present and passing.

Allowed `phase_status` values:

- `planned`
- `in_progress`
- `blocked`
- `complete`

### EX-7 GitHub publication boundary

Anything committed to GitHub, attached as retained evidence, or copied into PR-visible execution artifacts must be publish-safe for repo readers and reviewers.

Product repos must not commit or retain:

- secrets, credentials, tokens, certificates, or private keys
- live operational or runtime control configuration that is not part of the repo execution contract
- local workstation configuration, local override files, or machine-specific paths and identifiers
- local agent, editor, scheduler, or shell runtime state unless it is intentionally sanitized and required by the repo contract

If configuration guidance is needed in-repo, commit sanitized templates or examples only.

If logs, screenshots, reports, or evidence artifacts are retained in the repo, they must be redacted before commit so they do not expose secrets, local configuration, or operationally sensitive configuration.

## 5. Evidence Contract

Evidence is tracked in `state/artifacts.json`.

### EV-1 Required shape

`state/artifacts.json` must contain:

- `last_updated`
- `code_changes_present`
- `claims`
- `evidence`

### EV-2 Required evidence buckets

`evidence` must contain:

- `build`
- `test`
- `run`
- `deploy`

Each bucket must contain:

- `status`
- `reason`
- `updated_at`
- `paths`

`paths` must be an array.

`paths` may only be empty when all of the following are true:

- `metadata_only` is explicitly set to `true`
- the evidence type is allowed by `allowed_metadata_only_evidence_types`
- the bucket is not being used as file-backed passing or failing proof

### EV-3 Allowed evidence statuses

Only these values are valid:

- `passed`
- `failed`
- `not_run`
- `blocked`
- `not_required`

`reason` is required for `failed`, `not_run`, `blocked`, and `not_required`.

Evidence paths must be repo-relative artifact references. They must not be:

- absolute filesystem paths
- network URLs
- external system handles
- traversal paths outside the repo

If a path is declared as proof, it must resolve to a real non-empty repo-visible file.

`passed` and `failed` evidence must be file-backed and must not rely on metadata-only declarations.

### EV-4 Claim discipline

`claims` must contain:

- `implementation`
- `validation`
- `deployment`

Allowed claim values:

- `not_started`
- `in_progress`
- `complete`

### EV-5 Changed code requires evidence

If the current diff contains non-doc code or config changes, the validator expects:

- build evidence
- run evidence
- test evidence when required by config and phase

Each required bucket must be either:

- `passed`
- `failed`
- `not_run`
- `blocked`

`not_required` is only valid when the phase and config explicitly allow it.

### EV-6 Deploy evidence

Deploy phases require deployment evidence when `requires_deploy_evidence` is `true`.

If a deploy phase is marked `complete`, `evidence.deploy.status` must be `passed`.

### EV-7 Optional external inputs

`state/artifacts.json` may include optional `external_inputs`.

Each external input is reference-only and may supplement evidence when copied or attached into the repo.

Environment-layer artifacts may only appear here as reference-only external inputs.

Allowed `layer` values:

- `environment`
- `control`

Allowed `source` values include:

- `brewsync`
- `control-layer`

If `source = brewsync`, allowed `kind` values are:

- `plan`
- `inventory`
- `drift`
- `apply`
- `verify`
- `log`

Each external input must contain:

- `layer`
- `source`
- `kind`
- `paths`
- `reference_only`

`reference_only` must be `true`.

Declared external input paths must resolve to real repo-visible files when attached.

External inputs may support evidence review, but they do not replace:

- required repo state
- required evidence buckets
- product repo execution ownership

### EV-8 Supporting artifact directories

`evidence_directories` and `meta_directories` define repo-visible supporting-artifact roots for validator classification.

Defaults:

- `evidence_directories`: `artifacts/`
- `meta_directories`: empty

These directories are for supporting artifacts and metadata, not execution-layer source ownership.

### EV-9 Publication-safe evidence

Evidence and `external_inputs` must be publish-safe.

They must not retain:

- unredacted secrets or credentials
- active local configuration
- live operational control or runtime configuration that is not intentionally published as sanitized reference material

When operational evidence is needed for review, attach redacted repo-visible copies only.

## 6. State Contract

### ST-1 Roadmap state

`docs/roadmap/state.json` must contain:

- `current_phase`
- `phase_type`
- `phase_status`
- `active_task_id`
- `last_updated`

Allowed `phase_type` values:

- `planning`
- `docs`
- `build`
- `infra`
- `deploy`

### ST-2 Task tracking

`state/tasks.json` must contain `last_updated` and `tasks`.

The task referenced by `active_task_id` must exist in `tasks`.

### ST-3 Risk tracking

`state/risks.json` must contain `last_updated` and `risks`.

Each risk must keep a stable `id`. Unresolved risks may not disappear from later runs unless both of these fields are set:

- `resolved_at`
- `resolution`

### ST-4 Decision tracking

`state/decisions.json` must contain `last_updated` and `decisions`.

### ST-5 Run continuity

`state/handoff.json` must contain:

- `last_updated`
- `summary`
- `next_action`
- `discovered_issues`

Every discovered issue that materially affects delivery must set `requires_risk_log: true` and reference one or more `risk_ids`.

## 7. Phase Rules

These are the validator-enforced defaults. `templates/ai.config.json` can relax test requirements, but it does not remove the need to track state honestly.

| Phase Type | Allowed Change Shape | Required Evidence | Forbidden Claims |
| --- | --- | --- | --- |
| `planning` | planning artifacts only; not execution completion | none beyond explicit `not_required` markers | `claims.implementation = complete`, `claims.deployment = complete` |
| `docs` | docs/state support only; not execution completion | tests may be `not_required` | `claims.deployment = complete` |
| `build` | code, config, docs, state | build, run, and test unless config exempts tests | none |
| `infra` | code, config, docs, state | build and run, plus test unless config exempts tests | none |
| `deploy` | release and validation changes plus state | build, run, test unless exempt, and deploy | none |

If a `planning` or `docs` phase introduces non-doc code or config changes, the validator treats it as a contract violation.

## 8. Optional Integration Points

### IP-1 BrewSync to Product Repo

Allowed:

- environment verification outputs referenced in `state/artifacts.json`
- BrewSync logs or reports attached as repo-visible artifacts

Not allowed:

- BrewSync modifying execution state files
- BrewSync becoming the source of truth for roadmap, tasks, risks, or handoff state

### IP-2 Product Repo to Control Layer

Allowed:

- control layer reads repo state
- control layer triggers local or CI runs

Not allowed:

- control layer required for execution
- control layer owning execution state
- control layer replacing repo state as the validator input

## 9. Validator Mapping

| Rule Group | Enforced By `enforce-runtime-guardrails.js` |
| --- | --- |
| Layer boundaries | rejects execution-layer environment manifests, repo-external evidence paths, and external state fallbacks |
| Three-role workflow contract | requires repo workflow files under `ai/` and `state/`, requires a valid `state/controller.md` workflow state, rejects invalid run profiles, and treats workflow files as repo-visible handoff inputs rather than code |
| Execution contract | required file presence, JSON parsing, diff-aware state updates, phase/state change tracking |
| Evidence contract | evidence bucket shape, allowed statuses, required reasons, repo-relative artifact references, phase-aware evidence requirements |
| State contract | required fields, active task linkage, handoff continuity, risk continuity |
| Integration rules | optional external input validation without treating external systems as required dependencies |
| Risk discipline | unresolved risk removal, discovered issue to risk linkage, failed or blocked evidence without logged risk |
| Completion integrity | phase `complete` without passing required evidence, planning/docs phases with false implementation claims |
| Publication boundary | defined here as a required repo contract; product repos should add repo-local CI checks for secret scanning, forbidden tracked local or operational config, and redaction of retained evidence because repo-specific leak patterns are not inferable centrally |

## 10. Repo-Level Configuration

Product repos should copy `templates/ai.config.json` to `ai.config.json` and only change:

- `run_profile`
- `requires_test_evidence`
- `requires_deploy_evidence`
- `allowed_phases_without_tests`
- `strict_mode`
- `evidence_directories`
- `meta_directories`
- `allowed_metadata_only_evidence_types`
- `protected_environment_paths`

Config may relax evidence requirements for specific phases. It must not be used to:

- suppress state tracking
- suppress risk continuity
- suppress false completion checks
- require BrewSync or control-layer dependencies

`protected_environment_paths` is a minimal repo-relative prefix list for environment-layer boundaries. It defaults to `brew/`.

`run_profile` may be:

- `standard`
- `night`

Repo-specific Gemini GitHub review behavior may be customized with `.gemini/config.yaml` if desired, but that is optional and does not replace the repo execution contract.
