# Tasks

## Phase 1: Terminal Core + Command System

### S1
Title: SSH terminal core — fast connect, multi-session, session persistence
Status: pending
Phase: 1
Description: Build the terminal core that replaces Termius basics. SSH connection with host/port/key/password auth. Multiple simultaneous sessions in tabs (not windows). Session persistence — reconnect automatically on network interruption. Fast startup (<1 second to usable terminal). Session list as a compact table in a left sidebar: hostname, status (connected/disconnected as plain text), duration. Click to switch session. Keyboard shortcut to cycle sessions (Cmd+Tab between sessions). Keychain integration for credential storage (1Password or macOS Keychain, no plaintext).
Done when: SSH connect works with key and password auth. Multiple sessions in tabs. Auto-reconnect on network drop. Session list in sidebar table. Credential storage via keychain. <1s startup.

---

### S2
Title: Environment grouping — organize hosts by account, cluster, region
Status: pending
Phase: 1
Depends on: S1
Description: Group SSH hosts into environments: AWS accounts, Kubernetes clusters, regions, custom groups. Environment list as a filterable, collapsible table in the sidebar. Each environment shows: name, host count, status summary (N connected as text). Hosts within an environment shown as nested rows. CRUD for environments and hosts. Import from SSH config file (~/.ssh/config) as a bootstrap action. Drag-and-drop hosts between environments. Environments persisted locally as JSON.
Done when: Environments group hosts. Sidebar shows filterable environment table. Import from SSH config works. CRUD for environments/hosts. Persisted locally.

---

### S3
Title: Structured command history — searchable, tagged, reusable
Status: pending
Phase: 1
Depends on: S1
Description: Replace terminal scrollback with structured command history. Every command executed is captured as a record: command text, timestamp, host, exit code, duration, output summary (first/last N lines). History view as a sortable table: command, host, time, status (success/fail as text), duration. Full-text search across all commands. Tag commands (e.g., "deploy", "debug", "dangerous"). Filter by host, tag, status, date range. Click a command to re-run it (with confirmation). History persisted locally in SQLite.
Done when: Commands captured with metadata. History table sortable/filterable/searchable. Tags work. Click-to-rerun with confirmation. SQLite persistence.

---

### S4
Title: Save and run commands — parameterized reusable command library
Status: pending
Phase: 1
Depends on: S3
Description: Save frequently-used commands as named entries in a personal command library. Each saved command has: name, command template (with `{{param}}` placeholders), description, tags, target environment/host pattern. "Run" action shows parameter fill form, then previews the full command before execution. Command library as a searchable table: name, command preview, tags, last used, use count. Keyboard shortcut (Cmd+K) opens command palette for quick search and run. This is the core differentiator over Termius — commands are first-class objects, not scrollback text.
Done when: Save command from history or manually. Parameter placeholders work. Run preview before execution. Command library table searchable. Cmd+K palette works.

---

## Phase 2: Cloud + Audit

### S5
Title: AWS EC2 integration — connect without manual SSH config
Status: pending
Phase: 2
Depends on: S2
Description: Given AWS credentials (from environment or keychain), discover EC2 instances across regions. Show instances as a table: instance ID, name tag, state (running/stopped as text), type, region, private IP, public IP. "Connect" action per row — auto-configure SSH using instance metadata (IP, key pair, username from AMI). Support SSM Session Manager as an alternative to direct SSH. Auto-populate environments from AWS accounts. Instance health and metadata visible in a compact detail panel (not a dashboard). Refresh on demand, not polling.
Done when: EC2 instances discovered from AWS credentials. Instance table with connect action. SSH auto-configured from metadata. SSM Session Manager supported. Environments auto-populated.

---

### S6
Title: Session recording and command-level audit logs
Status: pending
Phase: 2
Depends on: S3
Description: Record full terminal sessions as replayable artifacts. Each session recording captures: all input/output, timestamps per keystroke, host metadata, user identity. Recordings stored locally as compressed files. Session replay viewer: playback at 1x/2x/4x with scrub bar. Command-level audit log: every command extracted from session with timestamp, user, host, exit code. Audit log as a searchable table: timestamp, user, host, command, status. Export audit log as CSV/JSON. This is mandatory for FedRAMP and enterprise compliance — every command attributable to a user.
Done when: Session recording captures input/output. Replay viewer with scrub works. Command-level audit log extracted. Audit table searchable. CSV/JSON export works.

---

### S7
Title: RBAC for environments and commands
Status: pending
Phase: 2
Depends on: S2, S4
Description: Role-based access control for shared environments: admin (full control), operator (connect + run), viewer (read-only, can watch sessions). Per-environment role assignments stored locally (single-user) or synced (team mode). Commands in the library can be restricted by role: "admin-only" commands require elevated role. Destructive commands (rm -rf, DROP, shutdown) auto-tagged as requiring confirmation regardless of role. RBAC enforcement logged in audit trail. No secrets in plaintext — credentials reference keychain entries, never stored directly.
Done when: Roles assigned per environment. Command restrictions by role. Destructive command confirmation enforced. RBAC logged in audit. No plaintext secrets.

---

## Phase 3: Team + AI

### S8
Title: Shared environments and command library (team collaboration)
Status: pending
Phase: 3
Depends on: S4, S7
Description: Teams share environments and command libraries via a shared configuration store (git repo or sync service). Shared environments show team member presence (who's connected where, as text in the session list). Shared command library: team members contribute commands, usage stats visible. Conflict resolution: if two people edit the same saved command, show diff and let the user choose. Read-only sharing for viewer roles. All shared actions logged in team audit trail.
Done when: Shared environments sync across team. Presence visible in session list. Shared command library with team contributions. Conflict resolution works. Team audit trail.

---

### S9
Title: Session sharing — live and replay
Status: pending
Phase: 3
Depends on: S6, S8
Description: Share a live terminal session with a teammate: they see real-time output in a read-only view. Optionally enable collaborative mode (both can type). Share a recorded session for async review — teammate opens replay viewer. Shared sessions linked in the audit trail (who watched, when). Invite via URL or team member list. No screen-sharing tools needed — this is native terminal sharing, lower latency, higher fidelity.
Done when: Live session sharing works (read-only and collaborative). Recorded session sharing works. Audit trail tracks viewers. Invite flow works.

---

### S10
Title: AI command assist — completion, explanation, impact simulation
Status: pending
Phase: 3
Depends on: S4
Description: AI-powered command assistance (never auto-executes): inline completion suggestions as the user types (accept with Tab), "Explain this command" action that shows plain-language breakdown of what a command does, "Simulate impact" for destructive commands (rm, DROP, shutdown) that shows what would be affected before execution. AI suggestions include confidence indicator and source (man page, documentation, pattern match). All AI interactions logged in audit. AI works offline with local model fallback (no mandatory cloud dependency). Toggle AI on/off per session.
Done when: Inline completion with Tab acceptance. Explain command shows breakdown. Simulate impact shows affected resources. Confidence indicator visible. Offline fallback works. Toggle per session.
