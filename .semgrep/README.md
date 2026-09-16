# Pinned semgrep ruleset (#284)

#149 pinned the semgrep *image* by tag and digest. This directory pins the
*ruleset*, so the CI/local gate no longer fetches rules at scan time and a PR can
no longer go red with no commit here.

Two pieces, and neither is a copy of the rules:

- `rules/` — a git submodule of [semgrep/semgrep-rules](https://github.com/semgrep/semgrep-rules)
  held at one commit. A submodule is a reference, not vendored content: this repo
  is public and Apache-2.0, the rules are under the *Semgrep Rules License v1.0*
  (internal use only; no redistribution), so they must never be committed here.
- `rules.tsv` — a generated manifest of the registry rule ids that made up the
  `https://semgrep.dev/c/auto` response at the snapshot, each resolved to its file
  in the submodule. Ids and paths only. `scripts/validate.sh` passes exactly these
  files as `--config` and fails hard if any is missing — there is no fallback to
  the registry (`--metrics=off` makes `--config=auto` impossible in semgrep).

| Field | Value |
|---|---|
| Source of rule ids | `https://semgrep.dev/c/auto` |
| Snapshot date | 2026-09-16 |
| Pinned commit | `40b8c63f75dc7c22c8a77482d73bfb864b146f7e` (2026-07-29) |
| Rules in manifest | 1055 (registry ids with no upstream file: 18) |
| Image the pin was verified with | `semgrep/semgrep:1.172.0@sha256:65dcd4408adda7c183a6b4550cb1e9b19f7f627a6fbb7e0559bd466bedc44d7b` |
| Owner | release (whoever bumps the semgrep image bumps this too) |
| Cadence | with every image bump, and at least every 90 days; `scripts/validate.sh` warns past 90 days and **fails** past 120 |

## Parity at the snapshot (whole-repo scan, same image)

| Config | Rules run | Findings |
|---|---|---|
| `--config=auto` (old, remote) | 272 | 0 |
| pinned manifest (new) | 272 | 0 |

Before #386 both configs reported the same three findings on `pnpm-workspace.yaml`
(`package_managers.pnpm.{pnpm-block-exotic-sub-dependencies,pnpm-minimum-release-age,pnpm-trust-policy}`),
latent since the initial import because the gate scans changed files only. #386
set those pnpm guards, so the whole-repo scan is clean under both configs. Rule
count and findings are identical either way: the pin changes nothing about
what the gate catches, only where the rules come from.

The 18 registry ids without an upstream file are all `trailofbits.*` (AGPL-3.0)
Go/Python rules that live in a different repository. Nothing in this repo is Go or
Python, so they never ran here, and dropping them keeps the AGPL text out of the
tree.

## Rule ids

Loading a rule from `.semgrep/rules/<path>/<file>.yaml` makes semgrep report it as
`semgrep.rules.<path>.<file>` (directory components, dot-joined; a repeated last
component is collapsed). `--config=auto` reported bare registry ids. `# nosemgrep:`
comments in this repo list both forms so they work under either.

## Refresh procedure

```bash
bash scripts/semgrep-refresh-rules.sh              # upstream default-branch head
bash scripts/semgrep-refresh-rules.sh <commit>     # a specific semgrep-rules commit
git add .semgrep/rules .semgrep/rules.tsv .semgrep/README.md
```

The script moves the submodule, re-reads the registry's current `c/auto` ids,
prints the added/removed ids and the ids it could not resolve, and rewrites the
manifest and the table above. Then run the parity scan and put the numbers in the
PR that bumps the pin (together with the image tag + digest):

```bash
docker run --rm -v "$PWD":/src -w /src semgrep/semgrep:1.172.0@sha256:65dcd4408adda7c183a6b4550cb1e9b19f7f627a6fbb7e0559bd466bedc44d7b \
  semgrep scan $(grep -v '^#' .semgrep/rules.tsv | cut -f2 | sed 's#^#--config=.semgrep/rules/#') \
  --metrics=off --disable-version-check --error .
```

A difference in what the gate catches is the thing to look at, not something to
normalise away.

## What the gate enforces about the pin

`scripts/validate.sh` refuses to run a scan that only looks pinned:

- the manifest header's submodule SHA must equal the committed gitlink;
- the snapshot date must not be in the future; older than 90 days warns, older
  than 120 fails;
- every row's file must be the file its registry id denotes (an id is the rule
  file's path with dots for slashes, plus the rule's own id), must exist in the
  submodule, and must declare that id; ids are unique; a file holding several
  rules is passed to semgrep once;
- at least 900 rules and 850 distinct files must resolve, so a shrunken manifest
  fails rather than quietly running less;
- any change under `.semgrep/` or to `.gitmodules` — including a deletion —
  scans the whole repository instead of just the changed files, so a pin bump
  shows what the new pin catches.

## Fresh clones and CI

`actions/checkout` does not fetch submodules, so `scripts/validate.sh` runs
`git submodule update --init --depth 1 -- .semgrep/rules` when the directory is
empty. That is one pinned git commit, not rules from the registry; it is fetched
from GitHub like the repository itself. A checkout that drifts from the pinned
commit fails the gate.
