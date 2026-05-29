# Local AI Adapter (Codex)

<!-- BEGIN ENTERPRISE-AI-STANDARDS LOCAL ADAPTER -->

This repo is adopted into Enterprise AI Standards.

Source of truth:

- Board and provider: `.ai/config.json`
- Task state: external ticket board, not repo markdown
- Runtime CLI: `ai-pipeline`
- Shared skills: local agent skill roots linked from Enterprise AI Standards by BrewSync
- Subagent roster: `ai/subagents.json` in the standards repo; adopted repos inherit it through EAS policy, not by copying it locally

Startup:

- **Pick a role-scoped reading list** from `docs/eas-loading-guide.md` in the standards repo before reading `enterprise-ai-standards.md`. Loading the full standard wastes ~40K tokens for non-operator sessions; the guide names which §sections each role needs (planner / builder / reviewer / finisher / adopter / operator).
- **Never full-read the heavy reference docs.** Do not read `enterprise-ai-standards.md`, `CHANGELOG.md`, or `docs/anti-patterns.md` end-to-end — look up the specific §section or A/C entry you need; full reads are operator-only. Per-role load budgets live in `docs/eas-loading-guide.md`.
- If the branch contains a ticket id, run `ai-pipeline current`. If on `main` / `master` or no ticket id, run `ai-pipeline next` before implementing. If the operator is asking for new work and no ticket exists, run `ai-pipeline plan "<title>"`.
- Read ticket comments with `ai-pipeline comments` (default: structured-metadata only; `--all` opts into full thread). Read diffs with `ai-pipeline diff` (lockfiles / generated / vendor stripped; 200KB cap). Never re-fetch raw thread or raw diff into the agent context.
- Search before broad reads: use `rg`, targeted provider queries, or deterministic CLI commands to locate the exact symbol, config, or ticket evidence before opening large files/directories. Read only the surrounding lines needed, and stop exploration once the next safe implementation step is clear.
- Prefer shared EAS skills for repo intake, git hygiene, validation, PR response, token conservation, churn avoidance, and multi-Mac workflow.
- For read-heavy or synthesis-light work, delegate to subscription-backed cloud subagents per the §A13 roster (Codex subscription helpers preferred for GitHub-API work). Subagent prompts MUST carry role, read-only guardrails, scoped task, and expected output format. Synthesize multi-helper output with Lagrange before editing. Local helpers only when cloud runtime is unavailable, the work touches local-only files, secrets, or unpushed worktrees.
- Treat `ai-pipeline claim` / `next` continuity notices as startup inputs: honor model-tier recommendations, repair skill-sync drift when reported, source MCP credentials through §D7 `cred.sh`.

Hard rules:

- AI task state lives on the external board only. Do not use `docs/roadmap`, `state/`, `work.json`, `state.json`, `markdown.json`, or markdown task lists.
- Canonical states: `ready_for_work` = unclaimed impl; `in_development` = active impl lease; `ready_for_local_testing` = cloud-completed handoff; `in_local_testing` = local-validation lease. Cloud agents may transition to `ready_for_local_testing`; local machines pick up with `ai-pipeline validate-next`.
- Cloud/container agents run advisory `validation.cloud_preflight` checks only. Do not open a PR or transition to `in_pr_review` until local validation has passed. Production deploys stay on protected CI or trusted local runners; cloud containers may only do preview/sandbox deploys unless the repo explicitly documents trusted-cloud.
- Local validation mirrors CI-required flags as closely as practical; CI failures override local assumptions. Validation scripts tolerate unset optional env vars under `set -u`. `ai-pipeline validate` base-freshness failures are blockers — rebase onto the named target and rerun before pushing.
- Run local validation before pushing; inspect failed check logs; rerun CI only for concrete infra/cancellation/flaky-test reasons. Before `gh pr merge --auto`, use `tools/check-auto-merge-prereqs.sh` so branches without required status checks cannot merge vacuously.
- Blocked PRs are first-class work. Before taking new `ready_for_work`, inspect owned open PRs in this repo; classify each red/dirty/blocked PR as `RED_CI_REQUIRED`, `SECURITY_REQUIRED`, `MERGE_CONFLICT_DIRTY`, `SIZE_REVIEW_BLOCK`, `REVIEW_THREAD_BLOCK`, `METADATA_GATE_BLOCK`, `WORKFLOW_SECONDARY_FAILURE`, or `DEPENDENCY_QUEUE`. Drain security/required CI first, then stale base, review/size blockers, metadata gates, workflow secondary failures, and clean dependency queues. Use `ai-pipeline review-comments --pr <number>` for review blockers. Do not stack more feature commits onto a `size:xl` / `needs-independent-review` branch; split/re-roll or get independent review.
- Before editing any source file, search the issue tracker for the filename and the pattern you are about to add or change; pause and coordinate if an open issue is already refactoring that file or removing that pattern.
- Enforce zero bad churn: keep edits scoped to the ticket/root cause, preserve the touched file's established style, avoid drive-by formatting/import sorting/public API renames, and do not commit scratch harnesses, IDE dotfiles, or agent-specific utility scripts unless the ticket explicitly requires them.
- Treat push as remote verification, not iterative debugging: run the ticket's `validation.local` commands and cheap PR-essential/changelog validators before the first push whenever the repo provides them; if remote CI fails, inspect logs and reproduce locally before another push or rerun.
- Budget-preflight notices from `ai-pipeline claim` / `next` are launch constraints: REDUCED → downshift + tighten tool scope; DEGRADED → finish only in-flight work at Mechanical tier; HALT → cadence stops unless explicitly overridden. Provider 429/503/overloaded responses follow §F7: record event, run `ai-pipeline rate-budget check`, downshift, bounded backoff, then escalate with terminal evidence.
- Keep git identity aligned with §F6: `+<host>` email aliases for commits; `Co-Authored-By: <Agent> (<host>) ...` trailers for agents. Rerun `tools/ai-pipeline/scripts/install-host-identity.sh --host <host>` when adopt reports drift.
- Run configured local-first reviews before CI spend when `.ai/config.json#local_review` declares them. Track actionable local-review findings in GitHub Issues, not markdown logs.
- In-session subagents extend hands, not leases: they may search, read, inspect, summarize, classify, and report — they must NOT claim/transition tickets, add evidence, push, open/comment/merge PRs, or mutate provider state. Do not paste raw subagent transcripts into tickets, PRs, or commits; extract verified facts.
- Before local validation, pre-push, or other expensive milestones, respect the board-state heartbeat; stop if the ticket is blocked, reassigned, or no longer in the active state for this session.
- Do not commit shared skills (BrewSync owns machine-local linking) or local lease/controller/planner/handoff state files. `.ai/` is local-only. This adapter is tracked so fresh clones discover the EAS contract; repo-specific guidance lives outside the managed block (`ai-pipeline adopt --force` preserves it).
- "Get latest" means update this repo only: `git fetch origin --prune && git pull --ff-only`.

<!-- END ENTERPRISE-AI-STANDARDS LOCAL ADAPTER -->
