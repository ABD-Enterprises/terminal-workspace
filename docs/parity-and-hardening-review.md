# term-snip — Parity & Hardening Review

Author: independent review
Reviewer perspective: modern macOS developer / cloud engineer who currently uses Termius daily
Reviewed: 2026-04-27
Repo SHA at review: `main` (HEAD)

## Executive verdict

**term-snip is not a functional Termius replacement today. The internal "96% parity" number is materially wrong** — once you score the things a daily-use cloud engineer actually depends on, parity is closer to **65–75%**, with one critical security default that should block any "ready" claim until fixed. The codebase is well-organized and the hard pieces (real SSH transport, SFTP, port forwarding, jump hosts) work. What's missing is identity modeling, keyboard-first interaction, terminal polish, secure defaults, and Mac-native chrome — the things that cause a switcher to bounce inside the first hour.

If the bar is "could I move my 100-host fleet here on Monday and not regret it by Wednesday," the answer today is no. The gap is closeable, but not by tightening the existing matrix — it requires re-questioning two design decisions documented below.

---

## 1. Recalibrating the parity number

`FEATURE_PARITY.md` self-reports 96% with most rows marked "Implemented." The matrix scores feature *presence*. A daily-use scorer weighs *quality, default-safety, and friction*. Re-scored on that basis:

| Row | Self-claim | Honest score | Why the gap |
|---|---|---|---|
| Host inventory CRUD | Implemented | ✅ Yes | Genuine. |
| Groups, tags, favorites, search | Implemented | ⚠️ Partial | Three overlapping organization axes (see §2.2). Filter bar enforces single-tag/single-group; no multi-select. `apps/desktop/src/components/hosts/HostFilterBar.tsx`. |
| Dense desktop shell, tabs, sidebar | Implemented | ⚠️ Partial | No favorites pinned in sidebar; reaching a known host always costs a navigation. |
| Command palette | Implemented | ❌ Stub | `apps/desktop/src/hooks/useCommandPalette.ts` only opens/closes; the registry is effectively empty. No "quick connect," no "run last snippet." |
| SSH connect/disconnect | Implemented | ✅ Yes | Real, validated. |
| Tabs and split panes | Implemented | ⚠️ Partial | Tabs not reorderable (`TerminalTabView.tsx:23`); splits are CSS-grid hard breakpoints, not draggable resize (`SplitLayout.tsx:14-25`). |
| Key import and generation | Implemented | ✅ Yes | Native via `ssh-keygen`. But see §3 — passphrase passed via `-P` is visible in `ps`. |
| Passphrase + known hosts | Partial (self) | ❌ Worse than self-rating | Default `hostKeyPolicy = "allowUnknown"` (`types/host.ts:6`) means silent TOFU on first connect. The "in-app missing-secret prompt" is a tab badge with no modal — see §4.3. |
| SFTP browser | Implemented | ⚠️ Partial | Works, but SFTP is a separate top-level page. Cannot open SFTP for the active session in one keystroke. No drag-from-Finder upload. |
| Snippets / multi-host exec | Implemented | ✅ Yes | Snippet broadcast is a real strength. |
| Port forwarding | Implemented | ⚠️ Partial | `PortForwardPanel.tsx` requires manual entry of all four fields each time; no presets, no last-used recall. |
| Session restore | Implemented | ⚠️ Partial | State restores; "needs secrets" state has no prompt UI — the tab just turns cyan. |
| Jump hosts | Implemented | ✅ Yes | Single-hop confirmed end-to-end. |
| Quick connect / duplicate | Implemented | ⚠️ Partial | Quick-connect only inside `/sessions`; not surfaced from Hosts or palette. |
| Agent forwarding + per-host env | Implemented | ✅ Yes | |
| Local prefs (density, shortcuts) | Implemented | ✅ Yes | |
| Import/export config | Implemented | ⚠️ Partial | SSH-config import is *lossy*: `lib/ssh-config.ts` silently skips wildcard hosts, `ProxyCommand`, `Match`, `ControlPath`. |

**Net:** 6 genuinely solid, 8 partial-with-friction, 2 broken-vs-claim, 1 outright stub. That's not 96%.

---

## 2. Data model — three layers of questions

### 2.1 Conceptual: the missing **Identity** entity

This is the single most important gap. **Termius's "Identity" (a reusable bundle of username + key/password + passphrase) does not exist in term-snip.** Auth is decomposed across three places:

- `HostRecord.privateKeyPath` — a string path on the host record itself (`types/host.ts:16`)
- `KeyRecord.assignedHostIds[]` — a parallel mapping on the key (per architecture audit)
- `ConnectionSecretRecord` — passphrase/password keyed by `hostId` only

That means:

1. **No reuse without duplication.** If 50 hosts share the same `deploy_key`, the path string is duplicated across 50 host records. Rotate the key path → 50 edits, or stale references.
2. **Identity changes are invisible.** Updating the username on one identity used by 50 hosts requires touching 50 hosts. Termius lets you change the identity once.
3. **Passphrase cache is host-scoped, not key-scoped.** Type the passphrase once for `prod-bastion` and you'll be re-prompted for every other host that uses the same key. `connection-secrets-store.ts` keys by `hostId`, not by key fingerprint.
4. **Linking is by string, not by ID.** Hosts → Keys link is a path-string match. Rename the file, the link silently breaks.

**Without an Identity entity, "we replace Termius" is structurally false at the data-model layer.** Everything downstream — keychain integration, sync, team vaults — inherits this.

### 2.2 Logical: groups vs. tags vs. environments — pick one, not three

There are *four* ways the schema lets you organize a host today, and they overlap:

| Field | Type | Purpose (claimed) | Actually used for |
|---|---|---|---|
| `host.group` | flat string ("Acme / Production") | hierarchy | UI grouping; not nested, just `/` in a string |
| `host.tags` | string[] | freeform labels | filter chips |
| `host.environment` | `Record<string,string>` | per-host SSH env vars (`AcceptEnv`) | runtime env propagation |
| `EnvironmentRecord` (separate entity) | `{name, type: "aws"|"k8s"|"region"|"custom"}` | logical grouping | **not wired to hosts** — no foreign key, no reference (per architecture audit) |

Two of those (`host.environment` the env-var map and `EnvironmentRecord` the entity) share the word "environment" but are unrelated. A new user reading the schema cannot tell them apart. The `EnvironmentRecord` entity is currently database furniture — it's persisted, but no host actually points to one.

Concretely, the question "show me all production hosts in us-east-1" has at least three valid query paths in this schema and no canonical one.

**Recommendation in §6.** This needs to collapse to one organizing model with proper foreign keys before adding anything else.

### 2.3 Physical: localStorage at fleet scale + dual-runtime debt

- **All persisted state lives in localStorage** via Zustand `persist` (13 stores, per architecture audit). Browser localStorage is a single ~5–10 MB string-key store, synchronous, with no transactions and no schema migration story beyond a `migrate` callback that only normalizes. At 200 hosts × 5 KB JSON each + session history (capped at 200), you're already in the hundreds of KB and a single corrupted JSON parse will take down the entire collection.
- **Session pane state is detached from host references.** A `SessionPane` holds `hostId` but there's no FK enforcement — restore can resurrect a pane pointing to a deleted host, error surfaces only on connect.
- **Two backends, same job.** `apps/desktop/server/backend.mjs` (~1248 LOC) and `src-tauri/src/native_transport.rs` both implement SSH lifecycle, SFTP, forwarding, jump hosts. Every feature must land twice. Test coverage isn't symmetric — the Tauri jump-host fixture exists; the Node equivalent doesn't. This is a tax the team is paying every PR until one side dies.

---

## 3. Security — risk-ranked findings

### 🔴 Critical

**S-1. Default trust policy is `allowUnknown` (silent TOFU).**
- `apps/desktop/src/types/host.ts:6` — `defaultHostKeyPolicy: "allowUnknown"`.
- `apps/desktop/server/backend.mjs:214-216` — host-key verification only fires when `knownHostPublicKey` is provided; absent, *anything* is accepted.
- A new user who clicks "Add host" → "Connect" gets no fingerprint prompt, no warning, no scan-first nudge. This is *worse* than OpenSSH defaults (which at least print the fingerprint and ask y/n on first connect). For a security-positioned product targeting cloud engineers, this is a shipping bug.

**S-2. Passphrases passed to `ssh-keygen` via `-P` flag.**
- `src-tauri/src/native_transport.rs:493`.
- `-P <passphrase>` is visible in `ps` to any unprivileged process on the same machine for the duration of the call. Use stdin or `SSH_ASKPASS` instead. Standard hardening.

**S-3. Plaintext credentials in Node backend memory.**
- `apps/desktop/server/backend.mjs:225-229` — `password` / `passphrase` arrive in the request body, are stashed on `connectConfig`, and live in V8 heap for the session lifetime. Not zeroed on disconnect. Browser-mode users hit this on every connect.

### 🟠 High

**S-4. No CSP. XSS escalates to SSH.**
- `src-tauri/tauri.conf.json` — `"security":{"csp":null}`.
- Combined with the localhost-bound Node backend (no Origin/CSRF check), any successful renderer-side XSS pivots straight to `http://127.0.0.1:8790/api/backend/*` and gets full SSH command access. Even without XSS, *any* other process on the user's machine can reach that port.

**S-5. Keychain is half-wired.**
- Keychain functions exist (`src-tauri/src/keychain_support.rs`) but the interactive-prompt path in `native_transport.rs:391-411` builds responses from the in-memory `BackendHostConnection`, bypassing Keychain. So Keychain is used for explicit "save" but not for the real session flow it advertises.
- Keychain entries are also keyed by `hostId`, not key fingerprint — so when a key is deleted from the keys-store, its passphrase is orphaned in Keychain forever.

**S-6. `termsnip_inspect_private_key` accepts an unrestricted path.**
- Per security audit. Renderer-side XSS (or a mis-rendered config field) can read any file the user can read — `~/.aws/credentials`, `.env`, anything. SFTP commands validate paths via `resolve_remote_path`; key inspection does not.

### 🟡 Medium

**S-7. Notarization succeeds-or-prays.** Release scripts notarize but don't independently re-verify the signed bundle before promotion (per security audit). Add `codesign --verify --deep --strict --verbose=2` and `spctl -a -t exec -vv` as gates.

**S-8. No CSRF / Origin validation on the Node backend.** Localhost binding is the only defense. Add an Origin allowlist or per-launch shared secret in the URL.

### 🟢 Low / Informational

- Gitleaks/semgrep configs are sane; no real secrets in git.
- Vault export correctly excludes runtime secrets (verified `lib/local-config.ts` per audit).
- `connection-secrets-store` correctly avoids `persist` middleware.

---

## 4. Workflow & usability — counted, not guessed

### 4.1 Click-count vs. Termius for the six daily flows

| Flow | term-snip | Termius (typical) | Verdict |
|---|---|---|---|
| A. Add host + first connect (with trust) | **8 clicks + ~5 keystrokes** spread across `HostsPage` → `HostEditor` → save → `KeysPage` (manage trust, separate page) → back to Hosts → connect | ~6 clicks, fingerprint confirm inline | Worse |
| B. Reconnect to a favorite | **2 clicks** (sidebar nav → Hosts → click) | 1 click (sidebar pin) | Worse |
| C. SFTP-upload one file to trusted host | **5 clicks + file picker** (`/transfers` → pick host → browse path → upload → choose file). No drag-from-Finder. | 3 clicks; drag-and-drop available | Worse |
| D. Snippet broadcast to 5 hosts | **7 clicks + 3 keystrokes** | ~5 clicks | On par |
| E. Local port forward `5432→remote pg` | **4 clicks + 4 keystrokes**, must retype all four fields each time (`PortForwardPanel`) | 3 clicks, presets remembered | Worse |
| F. Import `~/.ssh/config` | **1 click** + native file picker | 1 click | On par on count, **lossy on content** — see §4.5 |

**Pattern:** every recurring action costs at least one extra navigation hop because there's no quick-launch surface (no sidebar pinned favorites, no functional command palette, no Spotlight-style "type and connect"). For a daily user, this compounds quickly.

### 4.2 Keyboard-first — not really

Real shortcuts wired (`AppShell.tsx`):
- `Cmd+Tab` / `Cmd+Shift+Tab` — cycle session tabs ✅
- `Cmd+1`–`Cmd+8` — section jump ✅
- `Cmd+K` — opens command palette… that has no commands ❌

Missing:
- No "focus active terminal" key
- No "open SFTP for current session" key
- No "split horizontally / vertically" keys
- No "rerun last snippet" key
- No quick-connect from any page
- No tab-by-name jump

The existence of a `useCommandPalette` hook with no command registry is misleading — the parity matrix's "Implemented ✅" for command palette is false-positive. This is the single highest-leverage UX fix on the board.

### 4.3 The "needs secrets" silence

When a session restore needs a passphrase, `SessionRestoreManager` sets pane state to `pendingSecrets` and the tab badge turns cyan. **No modal opens, no prompt appears, no inline input.** The user sees a frozen tab and has to figure out the path: Hosts → host card → "Manage" → enter secret → back to Sessions → Resume. This is the exact opposite of Termius's "type passphrase, hit enter, you're in."

### 4.4 Terminal pane — bare bones

| Feature | Status | File |
|---|---|---|
| Reorderable tabs | ❌ | `TerminalTabView.tsx:23` (no DnD wired) |
| Resizable splits | ❌ | `SplitLayout.tsx:14-25` (fixed CSS grid) |
| User font choice | ❌ | hardcoded SFMono 13pt at `TerminalPane.tsx:205` |
| Color theme | ❌ | hardcoded slate/emerald palette `TerminalPane.tsx:207-227` |
| Copy-on-select | ❌ | not configured |
| Right-click paste menu | ❌ | not wired |
| Search-in-scrollback (`Cmd+F`) | ❌ | xterm `SearchAddon` not loaded |
| Persisted scrollback across reconnect | ❌ | not in sessionStorage |
| `prefers-color-scheme` honored | ❌ | hardcoded palette |
| Native macOS context menu | ❌ | browser default |

A power user opens term-snip, can't pick a font, can't search a 4000-line build log, can't reorder a tab, can't drag a pane wider. They close it.

### 4.5 SSH config import is silently lossy

`apps/desktop/src/lib/ssh-config.ts` parses `Host`, `Hostname`, `User`, `Port`, `IdentityFile`. It explicitly skips wildcard hosts (the `Host *` defaults block — comment says "Skip wildcard hosts for now") and ignores `ProxyJump`, `ProxyCommand`, `Match`, `ControlPath`, `ControlMaster`, `ServerAliveInterval`, `Include`, `LocalForward`, `RemoteForward`. There is no warning that the import was partial. A real-world `~/.ssh/config` for a cloud engineer is *mostly* `ProxyJump` and `Match host`. They'll import, see a fraction of their hosts, and assume the app is broken.

(Note: PR #15 had a richer parser handling wildcard inheritance and `ProxyJump` — it was closed yesterday as superseded. That parser is the missing piece here. See "ship-or-stop" §6.)

### 4.6 Onboarding cliff

Cold start → empty Hosts list → "Add host" button → modal asks for hostname/user/key/etc. with no example values. Demo mode exists (`Settings`) but is off by default in the native shell, and there's no "import sample hosts" or "try a local shell first" path. A first-run user has to *already* know what to type. Termius ships with a sample server you can immediately SSH into.

### 4.7 Mac-native gap

`src-tauri/tauri.conf.json` is one line, with no menu, no app menu, no security CSP, no window options beyond size. Concretely:

- No `File / Edit / View / Window / Help` menu (no `Cmd+,` for Preferences, no `Cmd+N` for new tab, no `Cmd+W` for close — all the things a Mac user expects)
- No dock badge (no unread/error indicator)
- No system notifications (Termius shows "session disconnected" / "command finished")
- No `prefers-color-scheme` respect
- No Touch Bar / Stage Manager affordances
- Window title is the static "Terminal Workspace" — doesn't reflect active host
- Product name still "Terminal Workspace" (not "term-snip"), bundle id is `com.abdenterprises.terminalworkspace`

This is a Tauri webview without a Mac shell on it. A Mac user notices in the first 30 seconds.

---

## 5. Architectural smells worth grappling with

(From the architecture audit; the parts that affect the parity claim.)

1. **Dual SSH implementation (Node + Rust) is permanent debt unless one side is killed on a calendar.** Pick a date, retire the Node backend in native, keep it only as the explicit "browser preview" path with a banner.
2. **Backend contract is one-way typed.** `lib/backend-contract.ts` types the TS side; Rust deserializes manually. Drift is undetected at build. Generate types from a single schema source.
3. **Tauri command names are flat strings.** `invokeTauriCommand<T>("termsnip_foo", args)` — typo = runtime crash. Wrap in a typed facade that exhaustively covers the 27 commands.
4. **Stores cascade-delete by handler, not by model.** Delete a host → snippet `targetHostIds`, session panes, key `assignedHostIds`, known-hosts entries, secrets, forwards all keep stale references unless the handler remembers. This is the kind of bug that ships and you find on a Tuesday.
5. **No telemetry, no error reporting, no crash capture.** That's a feature for privacy, but it means every bug a user hits is invisible. Add an *opt-in* local-only ring buffer at minimum.

---

## 6. Ship-or-stop — what has to land before "Termius replacement" is honest

If the bar is "I can move to this and not regret it," in priority order:

### Must-fix before any beta claim
1. **Flip `defaultHostKeyPolicy` to `requireTrusted` and add an inline first-connect fingerprint prompt.** The single most important security fix. Stops the silent TOFU.
2. **Replace `ssh-keygen -P <passphrase>` with stdin or `SSH_ASKPASS`.** ~20 lines in `native_transport.rs`.
3. **Add a CSP, an Origin allowlist on the Node backend, and a per-launch shared secret.** Three small changes that close the XSS-to-SSH pivot.
4. **Wire the "needs secrets" state to an actual prompt.** Modal or inline-in-tab. Today it's silent.
5. **Validate paths in `termsnip_inspect_private_key`.** Restrict to `~/.ssh/` and `~/Documents/keys/` or similar; allowlist not denylist.

### Must-fix before "daily use" is honest
6. **Introduce an `Identity` entity.** Hosts reference `identityId`, not `privateKeyPath`. Migrate existing data. This is a 2-week project but unblocks reuse, sync, and team features structurally.
7. **Pick one organizing axis.** Keep tags (multi-valued, free-form) and folders (hierarchical, single-parent), drop the dual `EnvironmentRecord` entity *or* drop the `host.group` string. Don't ship both.
8. **Make the command palette real.** Quick connect, run last snippet, jump to tab by name, open SFTP for current session, set forward. ~30 commands gets you most of the way.
9. **Pin favorites in the sidebar.** One-click reconnect to your top 5 hosts. Most-impact UI change for the lowest effort.
10. **Restore PR #15's SSH config parser** (or equivalent): `Host *` defaults inheritance, `ProxyJump`, multi-host lines, with a "N hosts imported, K skipped (reasons: …)" report after import.
11. **Terminal pane gets**: font picker, theme picker (or honor `prefers-color-scheme`), `Cmd+F` search-in-scrollback, copy-on-select, right-click paste, draggable splits, reorderable tabs. xterm.js supports all of these — they're addons + handlers, not a rewrite.
12. **Mac menu bar.** File / Edit / View / Window / Help. `Cmd+,`, `Cmd+N` (new tab), `Cmd+T` (new tab in current host), `Cmd+W`, `Cmd+Shift+]`/`[` for tab cycle.

### Must-decide
13. **Kill the Node backend in native shipping builds**, or commit to maintaining both indefinitely. Today's state — "Tauri owns *most* of it but Node is still there" — is the worst of both.
14. **Decide on persistence.** localStorage is fine for ~50 hosts, painful at 500. SQLite (via Tauri) is the obvious answer if you're staying local-first.

### Worth doing, not blocking
15. Drag-from-Finder upload in SFTP page.
16. Native notifications on session disconnect / long command completion.
17. Window title reflects active session.
18. `productName` = "term-snip", bundle id update.

---

## 7. Bottom line for the go/no-go decision

The codebase is *not* lost — it's solid bones with a thin and slightly misleading polish layer. The two things that would change my answer from "I'd switch back to Termius after one day" to "I'd live in this":

1. **Solving the Identity gap (§2.1)** — without it, you cannot ever credibly add team/sync features, and even single-user feels nagged for passphrases.
2. **Closing the keyboard-first + favorites gap (§4.1, §4.2)** — without it, every reconnect costs three clicks and the app feels like a webpage, not a Mac client.

Everything else on the must-fix list (§6.1) is achievable in a focused 4–6 week sprint. Items 6 and 8 are bigger. If those two land, "functional Termius replacement" becomes an honest claim. Until then, it isn't, regardless of what the parity matrix says.
