# Local AI Adapter (Claude)

<!-- BEGIN ENTERPRISE-AI-STANDARDS LOCAL ADAPTER -->

This repo is adopted into Enterprise AI Standards.

Source of truth:

- Board and provider: `.ai/config.json`
- Task state: external ticket board, not repo markdown
- Runtime CLI: `ai-pipeline`
- Shared skills: local agent skill roots linked from Enterprise AI Standards by BrewSync

Startup:

- If this branch contains a ticket id, run `ai-pipeline current`.
- If this branch is `main`, `master`, or has no ticket id, run `ai-pipeline next` before starting implementation work.
- If the user is asking for new work and no ticket exists, run `ai-pipeline plan "<title>"`.
- Prefer shared skills for repo intake, git hygiene, validation, PR response, token conservation, churn avoidance, and multi-Mac workflow.

Hard rules:

- Do not use `docs/roadmap`, `state/`, `work.json`, `state.json`, `markdown.json`, or markdown task lists as AI task state.
- Treat `ready_for_work` as unclaimed implementation work and `ready_for_local_testing` as unclaimed local-validation work; active leases are `in_development` and `in_local_testing`.
- Cloud coding agents may transition complete work to `ready_for_local_testing`; local machines pick it up with `ai-pipeline validate-next`.
- Cloud/container agents may run advisory `validation.cloud_preflight` checks with `ai-pipeline cloud-preflight`.
- Do not open a PR or transition to `in_pr_review` until local validation has passed.
- Keep production deploys in protected CI or trusted local runners; cloud coding containers may only do preview/sandbox deploys unless the repo explicitly documents a stricter trusted-cloud setup.
- Do not create local lease, controller, planner, reviewer, or handoff state files.
- Local validation must mirror CI-required flags as closely as practical; CI failures override local assumptions.
- Validation scripts must tolerate unset optional CI environment variables under `set -u`.
- Do not burn GitHub Actions minutes: run local validation before pushing, inspect failed check logs, and rerun CI only for a concrete infra, cancellation, or flaky-test reason.
- Run configured local-first reviews before CI spend when `.ai/config.json#local_review` declares them; local AI reviews are advisory analysis unless explicitly required.
- Track actionable local review findings in GitHub Issues, not markdown issue logs.
- Do not commit shared skills into this repo; BrewSync owns machine-local skill linking and repair.
- Keep `.ai/` local-only. This adapter file is tracked so fresh clones discover the EAS contract.
- Repo-specific guidance may live outside the managed adapter block in this file; `ai-pipeline adopt --force` preserves text outside the block.
- `get latest` means update only this repo: `git fetch origin --prune && git pull --ff-only`.

<!-- END ENTERPRISE-AI-STANDARDS LOCAL ADAPTER -->
