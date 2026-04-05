# Development

## Setup

- Run `npm run setup` from a fresh checkout.
- The setup flow uses `scripts/pnpmw.mjs` to resolve the pinned `pnpm` version through `pnpm`, `corepack`, or `npx`.
- Workspace install is configured to allow required native/build scripts for `cpu-features`, `esbuild`, and `ssh2`, so fresh installs do not require a manual `pnpm approve-builds` step.

## Day-to-Day Commands

- `npm run dev`: backend + Vite UI on `127.0.0.1:5173`
- `npm run dev:ui`: Vite UI only on `127.0.0.1:5173`
- `npm run test`: root Vitest unit + integration suite
- `npm run e2e`: Playwright browser suite
- `npm run build`: desktop production build
- `npm run native:check`: Tauri compile check plus icon generation
- `npm run native:key`: fast local native key inspection/generation fixture
- `npm run native:trust`: macOS localhost trust/key fixture
- `npm run native:fixtures`: macOS localhost transport fixture test
- `npm run native:notary:auth:test`: portable notarization auth dry run
- `npm run native:publish:dry-run`: promoted GitHub release publish dry run
- `npm run validate:guardrails`: execution/state/evidence validator using `ai.config.json`
- `TERMSNIP_RUN_E2E=1 npm run validate`: full lint/test/build/e2e pass

## Execution Contracts

- AI-assisted runs start at [ai/bootstrap.md](/Users/deffenda/Code/term-snip/ai/bootstrap.md); `/agents/*`, `/prompts/*`, and historical prompt files are supplemental repo-specific guidance only.
- [docs/roadmap/state.json](/Users/deffenda/Code/term-snip/docs/roadmap/state.json) is canonical.
- `/state/session.json`, `/state/tasks.json`, `/state/risks.json`, and `/state/decisions.json`
  are the shared execution state layer.
- `/state/artifacts.json` carries build, test, run, and deploy evidence.
- `/state/handoff.json` carries the next action plus discovered issues linked to open risks.
- [tools/validators/enforce-runtime-guardrails.js](/Users/deffenda/Code/term-snip/tools/validators/enforce-runtime-guardrails.js)
  plus `ai.config.json` is the authoritative enforcement layer for evidence, phase, and risk integrity.
- [.github/workflows/ci.yml](/Users/deffenda/Code/term-snip/.github/workflows/ci.yml) runs the
  validator plus repo test/build gates on pull requests.

## Environment Files

- `.env.example` documents the supported local and CI release variables.
- `.env.shared` carries non-secret shared defaults such as the browser/backend ports and release
  channel.
- `.env` is optional and overrides the shared defaults locally.

## Demo Mode

Demo mode remains the default operator experience in the browser review surface. The native shell
defaults to live transport.

- Sessions connect through the mock terminal transport.
- Transfers use a deterministic in-memory filesystem keyed by host.
- Key inspection, generation, known-host scans, snippet execution, and forward management return
  stable mock responses.
- The toggle lives in Settings and is persisted in the app preference store.

## Native Shell Bridge

The native shell now owns the app-facing transport seam:

- Tauri exposes backend status plus JSON and binary proxy commands for the native webview.
- Tauri exposes session lifecycle commands for create, resize, and close.
- Direct SSH and jump-host SSH sessions now connect in Rust instead of through the Node backend.
- Native SFTP list, mkdir, rename, delete, upload, and download now execute through OpenSSH from Rust.
- Native local and remote forwards now execute through Rust-owned OpenSSH control sessions.
- Native remote snippet execution now reuses the same Rust-owned control-session path.
- Native key inspection and generation now execute through Rust-owned `ssh-keygen` invocations.
- Native known-host scans now execute through Rust-owned `ssh-keyscan` plus local fingerprint
  verification.
- Tauri still owns the session stream bridge: native sessions emit terminal events directly, while
  backend-owned browser sessions continue to proxy websocket frames into the webview.
- Runtime passwords and passphrases persist through macOS Keychain in native mode.

The Node backend now only owns the browser transport path plus browser-mode key and trust calls.
The native transport implementation now lives primarily in
`src-tauri/src/native_transport.rs`, with macOS secret storage isolated in
`src-tauri/src/keychain_support.rs`.

## Browser Coverage

The Playwright suite exercises the seeded workspace and captures route screenshots into
`artifacts/e2e/`. The current smoke flow covers:

- hosts
- sessions
- snippets
- keys
- transfers
- settings

## Milestone Choice

Web demo quality remains the default screenshot and review path. The current hardening branch is
closing release credential portability, multi-surface regression coverage, and localhost fixture
preflight; the next product phase is vault and sync architecture.
