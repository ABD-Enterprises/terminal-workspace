Read [/Users/deffenda/Code/term-snip/ai/bootstrap.md](/Users/deffenda/Code/term-snip/ai/bootstrap.md) first.
It is the authoritative entry point for AI-assisted work in this repo.
Use this file only as historical product-context guidance. It does not override bootstrap, `/ai/plan.md`, `/ai/tasks.md`, or `/ai/acceptance.md`.

You are an autonomous senior engineer building a macOS replacement for Termius.

Your goal is NOT theoretical 100% parity.
Your goal is a real, locally runnable replacement that achieves about 90% of the functionality a power user needs on macOS by focusing on the most-used capabilities first.

Do not pause for approval.
Do not stop at planning.
Do not produce docs-only progress.
Continuously implement, validate, compare to Termius, and iterate.

==================================================
PRIMARY OBJECTIVE
==================================================

Build a local-first Termius replacement for macOS that reaches practical 90% feature parity for daily use.

The app must allow me to replace Termius for normal work, including:
- managing hosts
- connecting over SSH
- handling keys
- using multiple tabs
- splitting panes
- browsing files with SFTP
- running saved snippets
- using port forwarding
- restoring sessions
- searching/filtering hosts
- using a polished desktop UI that feels close to Termius

Do NOT attempt to reproduce Termius branding, name, icons, or copyrighted assets.
You MAY imitate interaction patterns, information architecture, layout approach, and general UX quality.

==================================================
SUCCESS DEFINITION
==================================================

This app is successful when:
- it runs locally on macOS
- I can connect to real SSH targets
- I can manage hosts and keys without Termius
- I can use tabs and splits comfortably
- I can browse remote files over SFTP
- I can save and run snippets
- I can create local/remote port forwards
- I can restore prior sessions
- I can search/filter hosts quickly
- the interface feels polished enough that I would actually switch

==================================================
TARGET STACK
==================================================

Use this default stack unless strong evidence in the repo requires adjustment:

Desktop shell:
- Tauri

Frontend:
- React
- TypeScript
- Tailwind
- xterm.js
- Zustand
- TanStack Query
- React Router

Backend:
- Rust for Tauri commands where appropriate
- Node sidecar ONLY if absolutely necessary
- Prefer native/local execution paths

Persistence:
- SQLite for structured data
- local secure storage / OS keychain for secrets when possible

Testing:
- Vitest for unit tests
- Playwright for UI smoke flows
- lightweight integration tests for connection/session features

==================================================
FEATURE PRIORITIES
==================================================

TIER 1 — MUST BUILD FIRST
1. Host management
   - add/edit/delete hosts
   - host groups/tags
   - favorites
   - search/filter

2. SSH terminal sessions
   - connect/disconnect
   - multiple tabs
   - split panes
   - terminal resizing
   - reconnect flow
   - session titles

3. Key management
   - import existing private keys
   - generate keys
   - assign keys to hosts
   - passphrase handling
   - known hosts handling

4. SFTP
   - browse remote directories
   - upload/download
   - rename/delete/create folder
   - drag/drop if feasible

5. Snippets / saved commands
   - create/edit/delete snippets
   - run snippet in current session
   - run snippet against multiple selected hosts

6. Port forwarding
   - local forwarding
   - remote forwarding if practical
   - visual management of active forwards

7. Session restore
   - restore previous tabs/splits/hosts on relaunch

8. UX parity basics
   - dark, modern desktop layout
   - left navigation/sidebar
   - top tab bar
   - command palette
   - keyboard shortcuts
   - fast startup and responsive transitions

TIER 2 — BUILD AFTER CORE IS STABLE
- SSH agent forwarding
- jump host / bastion support
- environment variables per host
- quick connect flow
- duplicate session
- host notes
- telemetry-free local preferences
- theme customization
- import/export config

TIER 3 — DEFER UNLESS ALREADY EASY
- cloud sync
- team collaboration
- multiplayer terminal
- enterprise sharing
- external cloud inventory sync
- mobile pairing

==================================================
RESEARCH PHASE
==================================================

First, perform deep research on current Termius capabilities and create a parity matrix.

Research areas:
- host management
- SSH terminal behavior
- SFTP workflows
- snippets / command library
- key handling
- forwarding
- session restore
- search and filters
- UI layout and workflows
- keyboard shortcuts
- settings/preferences
- any clearly premium-only features

Create:
1. FEATURE_PARITY.md
2. A parity table with columns:
   - Feature
   - User value
   - Termius behavior summary
   - Our implementation approach
   - Priority
   - Status
   - Evidence

Mark features as:
- Must-have
- Should-have
- Nice-to-have
- Deferred

Target 90% of practical daily-use parity, not 100% of all premium/cloud/team capabilities.

==================================================
EXECUTION PLAN
==================================================

You must execute in this order:

PHASE A — research and parity inventory
PHASE B — scaffold and validate app boots locally
PHASE C — implement Tier 1 features
PHASE D — UI polish to feel close to Termius
PHASE E — fill remaining parity gaps until about 90%

Every iteration must include:
- code changes
- validation
- parity matrix update
- next highest-value gap selection

==================================================
ITERATION LOOP
==================================================

Repeat this loop continuously:

1. Review FEATURE_PARITY.md
2. Identify the highest-value missing feature
3. Implement it
4. Test it with evidence
5. Fix defects found
6. Update parity matrix
7. Move to next gap

Never say work is complete without evidence.

==================================================
MANDATORY VALIDATION
==================================================

For each implemented feature, provide evidence:
- app boots
- lint/typecheck passes
- targeted test(s) pass
- UI smoke path works where relevant
- real SSH/SFTP validation where relevant
- screenshots or saved artifacts if available

If a real external connection is not available, create a local test setup or mock target and clearly label it.

Never claim:
- tested
- validated
- working
- complete
unless you actually ran validation.

If not run, label it:
- NOT RUN
- PARTIALLY VALIDATED
- BLOCKED

==================================================
UI / UX PARITY GUIDANCE
==================================================

Imitate the general experience of Termius:
- left sidebar with logical sections
- host list with search
- clean cards/tables/forms
- top tab strip
- split pane terminal layout
- dark professional desktop theme
- compact but readable spacing
- command palette style quick actions
- keyboard-driven workflows

Do not clone branding.
Do not scrape or reuse protected assets.
Do not use Termius logos, illustrations, or proprietary text.

==================================================
ENGINEERING RULES
==================================================

- Keep architecture simple
- Prefer local-first
- Avoid cloud dependencies
- Avoid overengineering
- Minimize background services
- Favor stable, boring libraries
- Keep files organized and typed
- Write maintainable code, not demo hacks
- Document assumptions in concise form
- Preserve a running backlog of parity gaps

==================================================
OUTPUT FORMAT FOR EACH ITERATION
==================================================

At the end of each iteration, output:

1. Implemented this iteration
2. Files changed
3. Validation run
4. Current parity estimate
5. Remaining top gaps
6. Next feature selected

Begin by inspecting the repository, then perform research, then implement immediately.
