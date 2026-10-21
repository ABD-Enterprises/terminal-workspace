# Agent instructions: terminal-workspace

<!-- fleet-core:begin (generated: edit the fleet source, not this block) -->
## Fleet core

Applies to every repository in the fleet. It is generated from one source; repository-specific rules go outside the markers.

### Evidence
- Read live state before stating it: fetch the remote, read the default branch, run the command. A number or an "X is missing" taken from a doc or a stale checkout is a claim to verify. A figure in a doc carries its date and how it was read.
- Find the root cause before proposing a remedy. For an unreachable or hung host, check its network interface and the previous boot's log before blaming memory.
- Give one account of a fact. If two places disagree, fix or flag one.
- Say plainly what you did not verify.

### Changes
- One bounded task per change request. Stay in scope: no drive-by edits and no agent scratch files committed.
- Run the repository's validation (named below) before pushing.
- A change request merges when a fresh-context review of the exact head has no unresolved P0 or P1 findings and every required check is green. A new commit needs a new review; a clean automatic merge of the base branch keeps the review.
- At most three open non-draft change requests per repository. While the fleet backlog check reports a backlog, finish and land existing work and start nothing new.
- Fix a finding that takes minutes in the current change; fold the rest into an existing tracking issue. A session closes at least as many issues as it opens on its own initiative; tickets the owner asks for in chat are separate.

### Safety
- Never print, log or commit tokens, passwords or keys. Use the credential helper the repository names.
- One writer per checkout: separate worktrees for separate writers. Do not force-push, rebase or delete a branch another session may own.
- Private repositories run CI on self-hosted runners only. A job that must not share a host (for example signing) runs on a dedicated self-hosted runner group, never on a GitHub-hosted runner without the owner's approval.
- Ask the owner only for a step no agent can do or for a spend or legal commitment; decide and record everything else.

### Layout
- AGENTS.md is the canonical agent file; where a CLAUDE.md exists it only imports it. Keep this file under 200 lines.
- Name this repository's validation command, merge rule and changelog rule outside the markers. Rules kept outside the repository are not visible here: if a task seems to need one, ask rather than guess.
- Shared skills are installed per machine from the fleet skills hub. Name the ones this repository expects below.

### Forge: GitHub
- Prefer REST (`gh api repos/OWNER/REPO/...`) to GraphQL for single reads: the rate-limit pools are shared by every session on the account.
- Required checks and review rules are branch protection or rulesets; read them with `gh api`. Review-thread resolution needs GraphQL.
<!-- fleet-core:end -->

## Repository-specific

- Public repository: every file here, and anything an agent writes into it (code, comments, commit messages, pull request text, changelog lines), is world-readable. Never add host names, user names, IP addresses, keys, tokens or other real data.
- What it is: a local-first macOS SSH client (Tauri native shell in Rust, a React and Vite desktop UI, and a Node backend used by the browser mode), Apache-2.0.
- Layout: `apps/desktop/` (UI in `src/`, Node backend in `server/backend.mjs`), `src-tauri/` (the Rust native shell and its tests), `tests/` (integration, browser, fixture and system tests; unit tests sit beside the UI source in `apps/desktop/src/`) with `vitest.config.ts` and `playwright.config.ts`, `scripts/` (validation, build, signing and release helpers), `docs/` (architecture, development, operations, release, security, testing).
- Docs: `docs/parity-and-hardening-plan.md` and `docs/parity-and-hardening-review.md` are dated planning notes written under the app's earlier name, "term-snip". Treat them as history, not as current instructions or current status.
- Validation: `npm run validate` (runs `scripts/validate.sh`: effort guard, version consistency, secret-on-argv check, lint, Vitest, desktop build, and on macOS with Rust installed `cargo fmt --check`, clippy with `-D warnings` and `cargo test`; changed-file Semgrep only when Docker is running). Run `npm run setup` first (the gate stops if dependencies are missing). Opt-in parts, each set by an environment variable on the same command: `TERMSNIP_RUN_E2E=1` (browser tests, as CI does), `TERMSNIP_RUN_SSH_FIXTURE=1`, `TERMSNIP_RUN_BACKEND_FIXTURE=1`, `TERMSNIP_RUN_RUST_AUDIT=1` and `TERMSNIP_RUN_NATIVE_TRUST=1`. CI runs `validate`, `rust-validate` and CodeQL (`.github/workflows/validate.yml`, `codeql.yml`).
- Rust changes: run `cargo fmt --manifest-path src-tauri/Cargo.toml` before the gate. The gate checks formatting first and fails on any warning, so an unformatted diff hides the real defect behind a style error.
- Changes to the PTY readers, session loops or the capture loops in `src-tauri/src/native_transport.rs`: also run `TERMSNIP_RUN_SSH_FIXTURE=1 bash scripts/validate.sh` before pushing. It starts throwaway `sshd` processes on localhost, is the only test that exercises the real transport, and a hang there shows as a timeout, not a failed assertion, so a green unit suite is not evidence. Changes to `apps/desktop/server/backend.mjs`, its auth gate or the session lifecycle: set `TERMSNIP_RUN_BACKEND_FIXTURE=1` the same way. Dependency changes: `TERMSNIP_RUN_RUST_AUDIT=1` (fetches an advisory database).
- Merge: the fleet core's merge rule applies. GitHub enforces two active rulesets on `main` (read 2026-10-21): "ABD default branch baseline" (no deletion or force push) and "main: required checks + PR" (a pull request, no required approvals, required checks `validate`, `rust-validate` and `CodeQL`). Branch protection also blocks force pushes and deletion and applies to admins. The independent review is therefore a rule of ours, not a platform gate.
- Changelog: add one line as a file `changelog.d/<slug>.md` in the form `- [LABEL] text (#N)` with `LABEL` one of `BREAKING`, `FEATURE`, `FIX`, `INTERNAL`, `SECURITY` (the pull request template asks for it, or the `changelog-skip` label for a change with no impact; `scripts/roll-changelog.mjs` rolls the files into `CHANGELOG.md` at release time and rejects a malformed line). Do not edit `CHANGELOG.md` for an ordinary change.
- Env files: `.env.shared` is tracked and holds only ports and the release channel. `.env` is git-ignored. Precedence in `scripts/load-env.sh` is an exported shell variable first, then `.env.shared`, then `.env` (the loader only fills variables still empty, so for a key in both files `.env.shared` wins, although the docs say `.env` overrides). `.env.example` lists the variable names for signing and notarization (Developer ID certificate, App Store Connect key, Apple ID password, keychain password): those values are never written into the repository. Check what is set with `env | cut -d= -f1 | grep -E 'TERMSNIP|MACOS'`, never print a value.
- Release and signing: do not run any of `npm run native:bundle`, `native:notarize`, `native:promote`, `native:publish`, `native:dmg`, `release:secrets:apply-env` or `release:secrets:audit` unless the owner asks. They sign with a Developer ID, submit to Apple, create or overwrite GitHub release assets, or write or read repository secrets. `npm run native:publish:dry-run` and `release:secrets:apply-env:dry-run` are the safe forms. Pushing a tag that starts with `v` triggers `.github/workflows/release-macos.yml`, which signs and publishes a release on a dedicated signing runner that must never be the shared pool: never push such a tag, and never move that job onto a shared runner or a GitHub-hosted one.
- Live data: the app and `npm run dev` (which starts the Node backend on `127.0.0.1`) connect to whatever SSH hosts the person running them configures, and the native shell stores passwords and passphrases in the macOS Keychain. Do not point a dev or test run at a real host or the owner's `~/.ssh`; use the demo mode, the browser tests, or the localhost fixtures above, which build their own throwaway `sshd` and home directory. `scripts/local-ssh-test-setup.sh` starts a Docker container with a fixed test login on port 2222: run it only when asked.
- Install-time: `npm run setup` is `pnpm install --frozen-lockfile` and runs the install scripts of `cpu-features`, `esbuild` and `ssh2` (the only ones allowed by the `pnpm` section of `package.json`). `.semgrep/rules` is a git submodule pinned to a public rule set; do not move the pin without updating the Semgrep checks (see the notes in `scripts/validate.sh`).
- Skills: this repository expects no hub skills.
