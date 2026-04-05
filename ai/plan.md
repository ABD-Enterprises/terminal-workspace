# Plan

## Goal
Keep the repo on one deterministic PR-driven AI workflow while completing the active product task in small slices.

## Constraints
- Keep scope narrow
- Prefer local changes
- No unnecessary architecture work
- Preserve existing behavior unless explicitly changing it
- GitHub PR review and CI are the only acceptance gate
- CI or review failures stay on the same task unless they reveal a planning failure

## Approach
1. Claude breaks work into one executable task slice at a time.
2. Codex implements only the current task and pushes branch updates for review.
3. GitHub PR review and CI decide pass or fail for the task.
4. Review failures route to `review_failed_fix_required`; only planning failures route back to `ready_for_claude`.
