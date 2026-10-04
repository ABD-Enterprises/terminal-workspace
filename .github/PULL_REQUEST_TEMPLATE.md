<!-- markdownlint-disable-file MD041 -->
<!--
Fill in every section from the diff, the linked issue's ai-task block, and the
changelog fragment. Agents may draft it; a human confirms it.

MD041 (first-line-heading) is disabled because GitHub renders this
template inline as the PR body — a top-level `#` heading here would
render as a giant heading above the user's PR description. The first
section heading is `## Summary` by design.
-->

## Summary

<!-- 1-2 sentences. What changed and why. AI reviewers: derive from the diff
     and the linked issue's `done_when` clauses. -->

## Linked issue

<!-- Required for any change that closes or advances a ticket. Bot and
     trivially scoped PRs (dependency bumps, typo fixes) may say "none". -->

Closes #__ISSUE__

## Changes

<!-- Bullet list of the meaningful changes. One bullet per logical change.
     AI reviewers: group by surface (api/cli/db/docs/tests). -->

-

## Acceptance criteria mirror

<!-- Mirror of the linked issue's acceptance criteria / `done_when` clauses,
     each checked only when it is actually met, so a reviewer can verify the
     change against the ticket without leaving the PR. -->

- [ ]

## Test plan

<!-- What was actually run, with results — e.g. `bash scripts/validate.sh`
     (plus `TERMSNIP_RUN_SSH_FIXTURE=1` for PTY/transport changes). Say so
     explicitly if something could not be run. -->

-

## Changelog entry

<!-- Add a one-line fragment under `changelog.d/` with one of these labels,
     OR apply the `changelog-skip` label to this PR for a no-impact change
     (e.g., comment typo).

       [BREAKING]  -> [major]   incompatible API, data, or operator change
       [FEATURE]   -> [minor]   new capability (additive)
       [FIX]       -> [patch]   bug fix or compatibility repair
       [INTERNAL]  -> [patch]   tests, CI, refactor, docs
       [SECURITY]  -> [patch]   vulnerability fix or hardening
-->

- [LABEL] one-line description matching the changelog.d fragment
