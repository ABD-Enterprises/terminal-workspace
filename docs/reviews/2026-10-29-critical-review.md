# Critical review — 2026-10-29

A security, maintainability, and usability review of `terminal-workspace`
at commit `ccd33ac` ("Polish shortcut-surface glyphs and the advanced-settings
disclosure (#466)").

**Scope:** `src-tauri/src/`, `apps/desktop/server/`, `apps/desktop/src/`,
`scripts/`, `tests/`, `docs/`, `.github/workflows/`.

**Method:** three parallel read-only reviews (security, maintainability,
usability), then an independent verification pass over the headline claims of
all three — reading the cited code directly, and in two cases *executing* the
relevant logic to prove the defect rather than infer it. The verification
record is in the appendix.

**Headline:** the native Rust path is in genuinely good shape. Two things need
attention — one confirmed exploitable weakness in the browser-mode backend, and
the fact that the product's most common failure produces no on-screen output at
all. Two orientation documents also actively mislead the next contributor.

---

## How to use this file

Every finding below is a **self-contained issue body**. To file one:

1. Copy the fenced block for the finding.
2. Open a new GitHub issue and paste it.
3. Use the title and labels given above the block.

The labels use the repository's own vocabulary — `bug`, `enhancement`,
`documentation`, `security`, `risk:*`, and the `ai/*` intake labels
(`ai/ready-for-work` means the finding is refined enough to implement as
written; `ai/in-refinement` means it needs a product or design decision first).

Findings are ordered by severity within each section. The priority order in the
next section is the recommended sequence for working through them.

> **A note on the security findings.** SEC-1 and SEC-2 are written so they can
> be fixed from the text: they name the mechanism, the files, the line numbers,
> and the fix. They do not contain a turnkey exploit. If you want the full
> attack sequence for the advisory or the fix's test design, it is available
> privately — do not paste it into a public issue.

---

## Verdict

| Area | Verdict |
|---|---|
| Native Rust transport | **Strong.** Host-key verification runs pre-authentication against a durable, cross-process-locked known-hosts store that fails closed. Shell quoting is a single conformance-tested implementation. Keychain secrets go over stdin, never argv. |
| Browser-mode Node backend | **Weak.** It authorizes on an `Origin` header alone, and the parser that guards every mutating route ignores the request's content type. Confirmed exploitable — see SEC-1. |
| Tauri IPC surface | **Tight**, with one over-grant — `sql:allow-load` (SEC-3). |
| Two-backend parity | **One proven divergence already.** The SSH-config glob matchers disagree, and the conformance corpus that exists to prevent exactly this does not cover them (MAINT-1). |
| Error visibility | **The weakest point in the product.** Every connect failure is computed correctly and then discarded to `console.warn` (UX-1). |
| Orientation docs | **Two are wrong in ways that cost time.** `FEATURE_PARITY.md` says the shipping backend does not exist; three docs describe an `.env` override the loader makes impossible (MAINT-2, MAINT-3). |

---

## Priority order

Ordered by *user-visible and security impact × effort*, not by severity label.

| # | Action | Findings | Effort |
|---|--------|----------|--------|
| 1 | Surface connect failures in the app shell | UX-1, UX-25 | S |
| 2 | Fix the browser-mode CSRF weakness | SEC-1, SEC-4 | M |
| 3 | Add host-key pinning to the Node backend; drop `sql:allow-load` | SEC-2, SEC-3 | M |
| 4 | Remove the internal notes from Settings; fix the delete-host copy; validate the host form | UX-2, UX-3, UX-5, UX-23 | S |
| 5 | Pin the two SSH-config glob matchers to one behaviour | MAINT-1 | S |
| 6 | Fix `.env` precedence; correct `FEATURE_PARITY.md` | MAINT-2, MAINT-3 | S |
| 7 | Extract the shared PTY session loop | MAINT-4 | M |
| 8 | Assert `stderrSemantics` on both sides; finish the typed-error migration | MAINT-5, MAINT-6 | S / M |
| 9 | Add e2e coverage for failure paths and the runbook journey | (see UX findings) | M |

Items 1, 4, 5 and 6 are small and independent — they can land in any order, on
their own branches, without waiting for anything else.

---

# Part 1 — Security

> The native (Rust) transport is the shipping path. Every finding in this
> section is specific to the **browser-mode Node backend**, except SEC-3
> (a Tauri capability) and SEC-6 (the native transport's algorithm list).

---

## SEC-1 — Cross-origin requests can reach the backend's mutating routes

**Title:** `security: the browser-mode backend authorizes on Origin alone, letting a hostile page drive its mutating routes`
**Labels:** `security`, `bug`, `risk:high`, `ai/ready-for-work`
**Files:** `apps/desktop/server/auth.mjs:20-25,124-146`, `apps/desktop/server/backend-buffers.mjs:35-75`, `apps/desktop/server/backend.mjs:1194-1210,1330-1352`

````markdown
## Summary

The Node backend treats a matching `Origin` header as an authentication
credential, and the allowlist that backs that check includes origins a local
process can bind on demand. The result is that a hostile web page can reach
the backend's mutating routes — including the route that runs a command on
the user's real SSH hosts.

## Mechanism

Four properties combine. Each is independently defensible; together they let
a page the user visits drive the backend.

1. **`isRequestAuthorized` accepts on Origin alone.**
   `apps/desktop/server/auth.mjs:124-146`. The token check is an *alternative*
   to the Origin check, not a requirement: if the request carries an `Origin`
   that is in `allowedOrigins`, it is authorized with `via: "origin"` and the
   per-launch token is never consulted.

2. **The default allowlist contains bindable origins.**
   `apps/desktop/server/auth.mjs:20-25` ships `http://127.0.0.1:5173` and
   `http://localhost:5173`. `apps/desktop/server/backend.mjs:81` resolves the
   allowlist from `TERMSNIP_ALLOWED_ORIGINS`, and that variable is **not set**
   in `.env.shared` — so the defaults apply to the shipped build, not only to
   development. Any local process can bind port 5173 and serve a page from an
   allowlisted origin.

3. **The JSON parser does not check the request's content type.**
   `apps/desktop/server/backend-buffers.mjs:35-75`. `readJson` parses whatever
   body arrives and never inspects `Content-Type`. A browser sends a
   *simple* cross-origin request — one that skips the CORS preflight — only
   when the content type is `text/plain`,
   `application/x-www-form-urlencoded`, or `multipart/form-data`. Because
   the parser accepts those, a cross-origin request reaches the route
   handler.

4. **The backend sets no CORS headers and answers no preflight.**
   There is no `Access-Control-*` header anywhere in `apps/desktop/server/`
   and no `OPTIONS` handler, so a request that *would* need a preflight fails
   one — but a request that does not need one goes straight through.

Every mutating route in this backend parses its body through `readJson`,
including `/api/backend/sftp/upload`, which POSTs base64 contents as JSON
rather than as multipart. So the single parser check governs all of them.

The routes reachable this way include `POST /api/backend/snippets/execute`,
whose body carries a command and a list of target hosts.

The WebSocket path is **not** affected: it requires an existing session id
(`randomUUID()`, so unguessable) in the path, and sessions can only be created
through the guarded HTTP routes.

## Why it matters

The browser-mode backend is local-only and bound to `127.0.0.1`, which limits
the blast radius to the user's own machine — but a local process can reach it
just as easily as the app can. The worst case is a command executed on the
user's real hosts, using credentials the backend already holds.

## Fix

The cleanest single control is to require a JSON content type on the body
routes, because the browser's preflight rules then do the rest:

1. **Require `Content-Type: application/json` in `readJson`**
   (`apps/desktop/server/backend-buffers.mjs`). Reject anything else with
   `415 Unsupported Media Type`. A hostile page can send a simple
   content type, and that request is refused here; it can send
   `application/json`, but that content type forces a preflight, and the
   preflight fails against a backend with no CORS headers.

   Both existing clients already send this header on every request —
   `apps/desktop/src/lib/backend-runtime.ts:479` and
   `tests/system/backend-transport-client.mjs:57` — so **no client change is
   needed**.

2. **Refuse `OPTIONS` explicitly**
   (`apps/desktop/server/backend.mjs`, next to the auth gate) with a `405` and
   no CORS headers, so a preflight always fails even if CORS headers are
   added by mistake later.

3. **Do not rely on the Origin allowlist as the control.** Keep it as
   defence in depth, and keep the dev origins out of the *shipped* default if
   the browser build is ever served from a fixed origin. The dev flow needs
   them; `TERMSNIP_ALLOWED_ORIGINS` is the documented way to opt in.

4. Consider requiring the per-launch token on mutating routes as well. The
   vite dev server is a trusted intermediary and could inject it into proxied
   requests, which would close the gap without depending on content-type
   rules at all.

## Also fix while you are here

`apps/desktop/server/backend.mjs:1219-1232` validates `authMethod` by
rejecting three specific values rather than allowlisting the permitted set,
so any other string — including `"agent"` — passes and reaches
`connectConfig.agent = process.env.SSH_AUTH_SOCK` at
`apps/desktop/server/backend.mjs:295-298`. Allowlist the accepted values, and
gate `agentForwarding` behind its own explicit check. See SEC-4.

## Confidence

Confirmed by reading the code. The four properties above were each verified
independently.
````

---

## SEC-2 — The Node backend performs no host-key verification and has no TOFU

**Title:** `security: the browser-mode backend connects without verifying the host key or pinning it for later`
**Labels:** `security`, `bug`, `risk:high`, `ai/ready-for-work`
**Files:** `apps/desktop/server/backend.mjs:276-293`

````markdown
## Summary

The Node backend installs a host-key verifier only when the caller already
supplied a known host key. Otherwise it connects with no verification at all
and records nothing, so a host whose policy is not `requireTrusted` is
MITM-able in browser mode.

## Detail

`apps/desktop/server/backend.mjs:290-293`:

```js
if (host.knownHostPublicKey) {
  connectConfig.hostVerifier = (key) =>
    Buffer.isBuffer(key) && key.toString("base64") === host.knownHostPublicKey;
}
```

With no `knownHostPublicKey`, ssh2 is given no verifier and takes its default
branch, which accepts the presented key without checking it.

This is a **parity gap, not a design choice**. The native transport records a
durable pin (`src-tauri/src/main.rs:1505-1508`) and detects a later key
change. The browser backend does neither.

## Why it matters

For any host whose policy is not `requireTrusted` — the opt-out for lab hosts,
and every host whose protocol is not `ssh`/`mosh` per
`apps/desktop/src/types/host.ts:350-352` — the browser-mode backend sends the
password to whatever answers, with no verification and no TOFU.

## Fix

Mirror the Rust behaviour: when no pin is supplied, pin the presented key into
the same durable known-hosts store, and fail on a later mismatch.

**Never leave `hostVerifier` undefined.**

## Confidence

Confirmed by reading the code and the vendored ssh2 behaviour.
````

---

## SEC-3 — `sql:allow-load` lets the renderer open SQLite databases at arbitrary paths

**Title:** `security: the sql:allow-load capability lets the renderer open SQLite databases outside the app directory`
**Labels:** `security`, `risk:medium`, `ai/ready-for-work`
**Files:** `src-tauri/capabilities/default.json:13-15`, `src-tauri/src/main.rs:4785`

````markdown
## Summary

The default Tauri capability grants `sql:allow-load` with no scope. In
`tauri-plugin-sql` 2.6.0 the `load` command calls `DbPool::connect` with the
renderer-supplied string, and the plugin's `path_mapper` does
`PathBuf::push` on it — which **replaces** the base path when the segment is
absolute. `LoadOptions::auto_create` defaults to true.

## Detail

`src-tauri/capabilities/default.json` grants:

```json
"sql:allow-load",
"sql:allow-select",
"sql:allow-execute"
```

The renderer only ever loads a fixed URL
(`apps/desktop/src/lib/persistence.ts:8,97`,
`sqlite:terminalworkspace.db`), so this is a **capability over-grant rather
than an active exploit path in current code**. It matters because the project
already treats renderer XSS as in scope (`src-tauri/src/main.rs:824-827`), and
this capability would turn a renderer compromise into a file
create/overwrite primitive outside the app's config directory.

## Fix

Drop `sql:allow-load` — the app only needs the preloaded pool — and narrow
`sql:allow-execute` / `sql:allow-select`. Alternatively pre-register the
database under a fixed name and reject `load` calls that carry a
renderer-chosen `db`.

## Confidence

Confirmed. The capability grant and the renderer's usage were verified
directly; the plugin's path-mapping behaviour was confirmed against the
vendored 2.6.0 source.
````

---

## SEC-4 — `authMethod` is validated by exclusion, so an ambient ssh-agent is silently used

**Title:** `security: authMethod is validated by exclusion, letting a caller request agent auth without it being asked for`
**Labels:** `security`, `risk:medium`, `ai/ready-for-work`
**Files:** `apps/desktop/server/backend.mjs:1219-1232,295-298`

````markdown
## Summary

`authMethod` is checked by rejecting three specific values rather than by
allowlisting the permitted set, so `"agent"` passes validation and reaches
the agent-forwarding branch.

## Detail

`apps/desktop/server/backend.mjs:1219-1232` rejects `password` without a
password, `privateKey` without a path, and `none`. Any other string is
accepted. `apps/desktop/server/backend.mjs:295-298` then does:

```js
if (host.agentForwarding && process.env.SSH_AUTH_SOCK) {
  connectConfig.agent = process.env.SSH_AUTH_SOCK;
  connectConfig.agentForward = true;
}
```

The backend process inherits the user's environment, so `SSH_AUTH_SOCK` is the
user's real agent.

## Why it matters

A caller can request agent-based authentication without the UI ever showing
it, and can request agent *forwarding* to a host of its choosing. This is the
amplifier that turns SEC-1 from "blind local request" into "blind remote
command execution as the user".

## Fix

Allowlist the accepted `authMethod` values (`password`, `privateKey`, `none`,
`agent`), and gate `agentForwarding` behind its own explicit, separately
authorized flag rather than riding along on the host record.

## Confidence

Confirmed by reading the code.
````

---

## SEC-5 — The auth-token sidecar follows symlinks and adopts any pre-seeded file

**Title:** `security: the backend auth-token sidecar is created without O_EXCL and follows symlinks`
**Labels:** `security`, `risk:low`, `ai/ready-for-work`
**Files:** `apps/desktop/server/auth.mjs:160-180`

````markdown
## Summary

`loadOrCreateBackendToken` writes the per-launch token to
`${tmpdir}/termsnip-backend.${port}.token` — a predictable path — with a
plain `writeFileSync` and no `O_EXCL`. It also *reads* any pre-existing file
at that path and adopts its contents as the expected token.

## Detail

- `apps/desktop/server/auth.mjs:168-172` reads the file and, if it holds at
  least 32 characters, returns those characters as the token. A process that
  can write that path can pre-seed a known token and then authenticate to the
  backend without reading anything.
- `apps/desktop/server/auth.mjs:178` writes with
  `writeFileSync(sidecarPath, ..., { mode: 0o600 })`. The `mode` applies only
  when the file is created; there is no `flag: "wx"`, so a pre-existing
  symlink is followed and the mode is not applied.

## Mitigating factor

On macOS `os.tmpdir()` resolves to a per-user `0700` directory
(`/var/folders/.../T`), which confines this to same-user processes. On Linux
(`/tmp`) it is cross-user.

## Fix

- Write with `writeFileSync(path, data, { flag: "wx", mode: 0o600 })` and
  retry on `EEXIST`.
- `lstat` the path before reading and refuse a symlink.
- Put the sidecar in a `0700` app-owned directory rather than `tmpdir`.

## Confidence

Confirmed by reading the code.
````

---

## SEC-6 — `ssh-dss` is accepted and pinned as a host-key algorithm

**Title:** `security: the native transport accepts and pins ssh-dss host keys`
**Labels:** `security`, `risk:low`, `ai/ready-for-work`
**Files:** `src-tauri/src/main.rs:1525-1535`

````markdown
## Summary

`host_key_algorithm_name` maps `ssh2::HostKeyType::Dss` to `"ssh-dss"`, and
`verify_native_host_key` accepts and pins it. DSA host keys are 1024-bit and
signed with SHA-1.

## Detail

`src-tauri/src/main.rs:1525-1535`:

```rust
ssh2::HostKeyType::Dss => "ssh-dss",
```

## Why it matters

Accepting DSA removes the SHA-2 / Ed25519 strength assumption from a host-key
negotiation. Exploitability depends on a server offering DSA.

**Do not conflate this with `ssh-rsa`.** Modern servers negotiate
`rsa-sha2-256/512` while the key blob stays `ssh-rsa`, so `ssh-rsa` is *not*
an equivalent problem and should not be treated as one.

## Fix

Reject `HostKeyType::Dss` before pinning, and consider enforcing a minimum
algorithm set.

## Confidence

Confirmed by reading the code.
````

---

## SEC-7 — Secrets are returned to the renderer for any host id, without a user gesture

**Title:** `security: load_host_secrets returns plaintext credentials for any host id with no confirmation`
**Labels:** `security`, `risk:low`, `ai/in-refinement`
**Files:** `src-tauri/src/main.rs:3097-3122`

````markdown
## Summary

`terminal_workspace_load_host_secrets` returns the plaintext password and
passphrase for *any* `host_id`, with no confirmation, unlock prompt, or
per-call consent.

## Why it matters

A compromised renderer can enumerate host ids and exfiltrate every stored SSH
credential without the user doing anything. The renderer already holds these
secrets during a connect, so this is not a new trust boundary — but it removes
the "only during a connect" constraint.

## Fix

Require an explicit user action, or a short-lived single-use grant, before
materialising secrets.

## Note

This needs a product decision about the connect flow, so it is marked
`ai/in-refinement` rather than `ai/ready-for-work`.

## Confidence

Confirmed by reading the code.
````

---

## SEC-8 — Untrusted pull-request code runs on a persistent shared runner

**Title:** `ci: untrusted pull-request code executes on a persistent shared self-hosted runner`
**Labels:** `security`, `risk:low`, `ai/in-refinement`
**Files:** `.github/workflows/validate.yml:3,27-34`, `.github/workflows/codeql.yml:38-45`

````markdown
## Summary

`validate.yml` triggers on `pull_request` and runs on
`vars.LINUX_RUNNER_LABELS` — a persistent, shared, self-hosted runner. A
malicious pull request executes arbitrary code on that host.

## Mitigating factors

The GitHub-token blast radius is contained: `permissions: contents: read` and
`persist-credentials: false` are both set, and the release job is correctly
excluded from this pool (`.github/workflows/release-macos.yml:27-35`). The
runner host itself is still exposed.

## Fix

Run untrusted PR builds on ephemeral runners, or harden the shared pool (no
credentials, no host mounts, network-isolated).

`SECURITY.md:33-47` already documents this posture and recommends
`validation.isolation=container`. This issue is about applying it.

## Note

`SECURITY.md` says the runner configuration lives in `vars`, not in-repo, so
the exact exposure needs a look at the runner fleet. Marked
`ai/in-refinement`.

## Confidence

Likely — depends on the runner's configuration, which is not in the repository.
````

---

## SEC-9 — Signing key material is written world-readable and passwords appear in argv

**Title:** `ci: the Developer ID p12 is written with default permissions and signing passwords are passed as argv`
**Labels:** `security`, `risk:low`, `ai/ready-for-work`
**Files:** `.github/workflows/release-macos.yml:145-160`

````markdown
## Summary

The Developer ID `.p12` — which contains the private key — is written by
`Path(...).write_bytes(...)` with default permissions (`0644` under the
default umask) and remains until the final cleanup step. The certificate and
keychain passwords are passed as `security` CLI arguments, which any local
user can read from `ps`.

## Mitigating factors

The job is pinned to a dedicated signing runner, and the `security import -A`
permission is corrected by the subsequent
`set-key-partition-list -S apple-tool:,apple:,codesign:`
(`.github/workflows/release-macos.yml:160`).

## Fix

- Write the p12 with `0600` (open with `os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)` or `chmod 0600` immediately after writing).
- Where the platform allows it, pass the p12 password to `security import` without putting it in argv.

## Confidence

Confirmed by reading the workflow.
````

---

## SEC-10 — The vault-sync envelope digest is unkeyed

**Title:** `security: the vault-sync envelope digest is unkeyed, so it detects corruption but not tampering`
**Labels:** `security`, `risk:low`, `ai/backlog`
**Files:** `apps/desktop/src/lib/vault-sync-contract.ts:196-262`, `apps/desktop/src/lib/vault-sync-runtime.ts:16-35`

````markdown
## Summary

The envelope "digest" is a plain SHA-256 over header + nonce + ciphertext
(`createDigestMaterial`, `sha256Hex`) with no key. It detects corruption, not
tampering.

## Why it matters today: little

No apply path exists yet — `evaluateVaultSyncEnvelopeTrust` and
`inspectVaultSyncEnvelopeWithLocalPolicy` are the only consumers, and nothing
decrypts or applies an envelope. The risk is prospective.

## Fix

When the apply path lands, specify AES-GCM (or XChaCha20-Poly1305) with a
passphrase-derived key (Argon2id / scrypt) plus an envelope signature, and
label the existing digest field explicitly as a corruption check only.

## Note

No code change is possible until the apply path exists, so this is
`ai/backlog` rather than `ai/ready-for-work`.

## Confidence

Confirmed by reading the code; exploitability is prospective.
````

---

# Part 2 — Maintainability

---

## MAINT-1 — The two SSH-config glob matchers have already diverged

**Title:** `bug: the Rust and Node SSH-config Include glob matchers disagree, and the conformance corpus covers neither`
**Labels:** `bug`, `risk:medium`, `ai/ready-for-work`
**Files:** `src-tauri/src/main.rs:3520`, `apps/desktop/server/backend.mjs:120`, `tests/fixtures/security-helper-conformance.json`

````markdown
## Summary

Both backends implement the `Include` glob matcher for `~/.ssh/conf.d/*`
patterns, and they no longer agree. The conformance corpus exists to prevent
exactly this class of drift, and neither matcher is in it.

## The divergence

Rust's `glob_match` (`src-tauri/src/main.rs:3520`) collects
`pattern.chars()` / `text.chars()` — Unicode **scalar values** — and
hand-rolls `*` (any run) and `?` (exactly one character). Its doc comment
states that `[` is treated literally.

Node's `globToRegExp` (`apps/desktop/server/backend.mjs:120`) builds
`new RegExp(source)` with **no `u` flag**, substituting `.` for `?` and `.*`
for `*`.

Both implementations were extracted and executed against the same inputs:

| Case | Rust | Node |
|---|---|---|
| `?` vs an astral character (`a🦀b`) | matches | **does not match** |
| `*` vs a newline (`a\nb`) | matches | **does not match** |
| `?` vs a newline (`a\nb`) | matches | **does not match** |

`.` in a non-`u` regex consumes one UTF-16 code unit and does not match a
newline.

## Why it matters

A file in `~/.ssh/conf.d/` whose name contains an astral character is matched
by native mode and skipped by browser mode — **the same SSH config yields a
different host set** depending on which backend is running.

This is the defect class the corpus was built to catch: the fixture's own
`sanitizeFilename` comment records *"the JS regex lacked the u flag"*. The
same bug class survived in the glob path, unguarded.

The corpus has 8 groups (`normalizeRemotePath`, `resolveRemotePath`,
`sanitizeFilename`, `shellSingleQuote`, `environment`, `stderrSemantics`,
`copyKeyFailures`, `remoteCommandFailures`) and **no glob group**. The one
ordering test (`apps/desktop/src/lib/ssh-config-include.test.ts:238`) mocks
the lister away entirely and uses `10-staging` / `20-prod`, which both
orderings agree on.

## Fix

1. Add a `globMatches` group to
   `tests/fixtures/security-helper-conformance.json` covering an astral
   character, a newline, `?` vs `*`, and a literal `[`. Derive the expected
   values from the **Rust** behaviour — `docs/architecture.md` states the
   Rust path is the shipping transport, so it is the reference.
2. Assert the new group from both harnesses:
   `src-tauri/src/native_transport_conformance_tests.rs` (the `cases()`
   helper around line 43 asserts every group is non-empty, so a group that is
   added but never called still fails) and
   `tests/integration/security-helper-conformance.integration.test.ts`.
3. Fix the Node matcher to match Rust: the `u` flag so `.` consumes one code
   point, and the `s` flag so `.` matches a newline.
4. **Handle lone surrogates.** With the `u` flag, `new RegExp` throws a
   `SyntaxError` on an unpaired surrogate. Filenames on macOS can contain
   arbitrary bytes, so a pattern built from a real filename can throw. The
   current code does not throw — do not introduce a crash path. Detect the
   invalid pattern and skip it explicitly, with a comment saying why.
5. Add a plain Rust unit test for `glob_match` covering the same cases.
6. Keep the `nosemgrep` suppression on that line honest — the existing
   justification says the input is local and not attacker-facing; that stays
   true, and the `u`/`s` flags do not introduce a ReDoS vector.

## Confidence

Confirmed, and proven by executing both implementations.
````

---

## MAINT-2 — `.env` overrides are silently impossible, and three docs say the opposite

**Title:** `bug: .env cannot override .env.shared, and three documents state that it does`
**Labels:** `bug`, `documentation`, `risk:medium`, `ai/ready-for-work`
**Files:** `scripts/load-env.sh:56,62-63`, `docs/development.md:34`, `docs/release.md:113`, `docs/operations.md:27`

````markdown
## Summary

The env loader exports a key only when it is currently empty, and loads
`.env.shared` *before* `.env`. By the time `.env` is read, every key in
`.env.shared` is already set — so **`.env` can never override
`.env.shared`**.

## Detail

`scripts/load-env.sh:56`:

```bash
if [[ -z "${!key:-}" ]]; then
  export "$key=$value"
fi
```

`.env.shared` is loaded at line 62, `.env` at line 63.

Verified empirically against the real script: with the repository's
`.env.shared` loaded (`TERMSNIP_UI_PORT=5173`,
`MACOS_RELEASE_CHANNEL=stable`), feeding a simulated `.env` containing
`TERMSNIP_UI_PORT=3999` and `MACOS_RELEASE_CHANNEL=nightly` left **both** at
the `.env.shared` values.

## The docs say otherwise

- `docs/development.md:34` — *".env is optional and overrides the shared defaults locally"*
- `docs/release.md:113` — *".env: optional local overrides"*
- `docs/operations.md:27` — *"loads shared defaults from `.env.shared` and local overrides from `.env`"*

`AGENTS.md:48` documents the inversion correctly — the stale ones are the
three files above.

## Why it matters

All four keys in `.env.shared` (`TERMSNIP_BACKEND_PORT`,
`TERMSNIP_BACKEND_BASE_URL`, `TERMSNIP_UI_PORT`, `MACOS_RELEASE_CHANNEL`) are
un-overridable by the documented mechanism. A developer who changes the UI
port in `.env` gets 5173, with no error and no warning.

## Fix

Track which keys `.env.shared` supplied, and let `.env` replace exactly
those, while still refusing to clobber a variable that was already set in the
real process environment. That last part is the important safety property: an
exported shell variable must still win.

Add a test that asserts the precedence in both directions, and wire it into
`scripts/validate.sh` so the gate keeps it honest. The test must be
hermetic — temp files, not the repository's own `.env`.

## Confidence

Confirmed by reading the code and by running the loader.
````

---

## MAINT-3 — `FEATURE_PARITY.md` contradicts `docs/architecture.md` on the project's central fact

**Title:** `docs: FEATURE_PARITY.md says the shipping native backend does not exist and still carries unfilled template rows`
**Labels:** `documentation`, `bug`, `risk:low`, `ai/ready-for-work`
**Files:** `FEATURE_PARITY.md:46` and rows 44-59

````markdown
## Summary

`FEATURE_PARITY.md` is the orientation document a new contributor is most
likely to open, and it tells them the shipping backend does not exist.

## Detail

Row 46 states:

> *"Implemented a local Node bridge with `ssh2`, websocket terminal IO,
> reconnect flow, and real local sshd validation; **native Tauri/Rust backend
> still pending**"*

`docs/architecture.md` states the opposite — the Tauri shell owns the
shipping transport and the Node backend is a browser-preview-only artifact.

The native backend demonstrably exists: **38 registered Tauri commands**
(`src-tauri/src/main.rs`, `generate_handler!` around line 4829),
`native_transport.rs` at 3,377 lines, `keychain_support.rs` at 1,233 lines.

The file also contains **24 unfilled template placeholders** — `competitor X`,
`[competitor X](https://competitor.com/documentation/ssh-keys)`,
`competitor blog: [competitor X](...)` — across rows 44-59. It is a template
that was never filled in, and it is not maintained.

## Fix

- Correct row 46 to describe the real current state.
- Strip every `competitor X` / `competitor.com` placeholder. Preserve each
  row's real "what we implemented" content — that is the valuable part.
- Add a short header stating what the table is, carrying a date and how it
  was verified, per this repository's rule that a claim in a doc carries its
  date.
- Cross-reference `docs/architecture.md`.
- Optionally add a cheap CI check that greps the file for `competitor`
  placeholders so the template cannot come back.

## Confidence

Confirmed by reading the file and counting the placeholders.
````

---

## MAINT-4 — Two ~240-line session loops are 88% identical

**Title:** `refactor: extract the duplicated jump-host and external-command session loops`
**Labels:** `enhancement`, `risk:medium`, `ai/ready-for-work`
**Files:** `src-tauri/src/main.rs:1736-1966`, `src-tauri/src/main.rs:1968-2211`

````markdown
## Summary

The jump-host session loop and the external-command session loop are two
~240-line copies of the same PTY lifecycle, measured at **0.882 normalised /
0.893 raw similarity** with 51 changed lines out of ~475.

## Why it matters

Every fix to the PTY reader has to be applied twice. They have **already**
diverged in observable ways:

- the external-command loop branches on `prompt_responses.is_empty()` while
  the jump loop always spawns `spawn_jump_session_reader`
- only the external loop manages `cleanup_dir`

A bug fixed in one is silently absent from the other — and
`scripts/validate.sh:79-91` documents a reader-thread fix that was wrong,
passed a green local suite, and showed up in CI as a **timeout rather than a
failing assertion**. That is exactly the failure mode a duplicated loop
invites.

## Fix

Extract `run_pty_session_loop(app, session_id, state, command_builder,
prompt_policy, exit_label)`; both call sites collapse to ~40 lines.

Land it as one commit with no behaviour change, then re-verify with the
ignored sshd fixture (`TERMSNIP_RUN_SSH_FIXTURE=1 bash scripts/validate.sh`).

## Confidence

Confirmed by measuring the similarity directly.
````

---

## MAINT-5 — The `stderrSemantics` conformance group is asserted by nobody

**Title:** `bug: the stderrSemantics conformance group is asserted by neither harness`
**Labels:** `bug`, `risk:medium`, `ai/ready-for-work`
**Files:** `tests/fixtures/security-helper-conformance.json:418-433`

````markdown
## Summary

The one *known intentional* behavioural divergence between the two backends is
recorded in the conformance corpus and asserted by nothing.

## Detail

The group records that `node-snippet` means `remote-stderr-only` (ssh2
separates remote stderr) while `native-snippet` means
`combined-ssh-process-stderr` (the OpenSSH CLI mixes remote stderr with
client diagnostics).

A repository-wide search for `stderrSemantics`,
`remote-stderr-only`, and `combined-ssh-process-stderr` returns matches
**only inside the fixture file** — no Rust `#[test]`, no JS `it(...)`, no
doc. Every other group has a test on both sides
(`src-tauri/src/native_transport_conformance_tests.rs:169-301`;
`tests/integration/security-helper-conformance.integration.test.ts`). The Rust
harness even has a `cases()` helper
(`src-tauri/src/native_transport_conformance_tests.rs:43`) that would assert
the group is non-empty — but no test calls it with `"stderrSemantics"`.

## Why it matters

A snippet failure surfaces different stderr text in native and browser mode,
and nothing would fail if that gap widened.

## Fix

Add a per-side test asserting the local meaning, or move the record into
`docs/parity-and-hardening-review.md` where it will actually be read.

## Confidence

Confirmed by a repository-wide search.
````

---

## MAINT-6 — 25 of 38 IPC commands still return bare `String` errors

**Title:** `refactor: finish the typed IpcError migration for the remaining 25 commands`
**Labels:** `enhancement`, `risk:low`, `ai/ready-for-work`
**Files:** `src-tauri/src/main.rs` (all `#[tauri::command]` fns), `src-tauri/src/sftp.rs`

````markdown
## Summary

The typed-error design is sound and the migration is deliberate, but 25 of the
38 IPC commands still return a bare `String` error, so the frontend has to
regex-match English prose to classify them.

## Detail

Tally of all 38 commands: **String 25, `IpcError` 5, `KeyCommandFailure` 3,
`SshConfigCommandFailure` 2, infallible 3.**

`src-tauri/src/ipc_error.rs:1-10` states the codes match
`ssh-error-classifier.ts`'s categories *"for the commands not yet migrated"*,
and `apps/desktop/src/lib/ssh-error-classifier.ts:107-125` reads
`error.code` first and falls back to regex.

## Why it matters

For 25 commands the frontend can only match prose (for example
`/Permission denied \(publickey/i` at
`apps/desktop/src/lib/ssh-error-classifier.ts:46`). Rewording a Rust error
string silently changes a user-facing category, and **no test fails**.

## Fix

Continue the documented migration. Batch the nine secrets commands
(`load/store/clear_host_secrets`, `*_key_passphrase`, `*_identity_passphrase`)
next — they are the most user-visible and already have a formatter module to
extend.

## Confidence

Confirmed by the reviewer's tally of the command signatures.
````

---

## MAINT-7 — Three implementations of "lexical order"; two are dead and the live one is not OpenSSH's

**Title:** `bug: three different lexical orderings exist for SSH config matches, and the renderer sorts a third way`
**Labels:** `bug`, `risk:medium`, `ai/ready-for-work`
**Files:** `apps/desktop/src/lib/ssh-config-include.ts:229`, `src-tauri/src/main.rs:3680`, `apps/desktop/server/backend.mjs:198`

````markdown
## Summary

Three different sort orders exist for the same list, two of them are dead
code, and the one that is live is not the order OpenSSH uses.

## Detail

- Rust sorts `left.name.cmp(&right.name)` — byte / Unicode-scalar order.
- Node sorts `left.name.localeCompare(right.name)` — ICU collation.
- The **renderer sorts again** with `localeCompare` before concatenating, so
  both backend sorts are dead for the app path. The only other consumer of
  the HTTP endpoint is `tests/system/backend-transport-client.mjs:173`.

Measured divergence on
`["10.conf","2.conf","Beta.conf","Zebra.conf","_x.conf","a b.conf","alpha.conf","ä.conf"]`:

- byte order → `["10.conf","2.conf","Beta.conf","Zebra.conf", …]`
- `localeCompare` → `["_x.conf","10.conf","2.conf","a b.conf","ä.conf","alpha.conf","Beta.conf","Zebra.conf"]`

The only ordering test
(`apps/desktop/src/lib/ssh-config-include.test.ts:238`) mocks the lister
entirely and uses `10-staging` / `20-prod`, which both orderings agree on.

## Why it matters

`apps/desktop/src/lib/ssh-config-include.ts:202` claims it inlines matches
*"in lexical order, exactly as OpenSSH does"* — but `localeCompare` is not
OpenSSH's lexical order (OpenSSH sorts by bytes, so `Zebra` precedes
`alpha`). The two backend sorts each imply the backend owns ordering it does
not actually own.

## Fix

Choose one comparator, apply it only in the resolver, delete the two backend
sorts, and add a fixture case that distinguishes byte order from locale
collation.

## Confidence

Confirmed by the reviewer.
````

---

## MAINT-8 — `main.rs`'s weight is session lifecycle, not IPC

**Title:** `docs: main.rs is mostly session lifecycle, not the IPC surface a refactor would target`
**Labels:** `documentation`, `enhancement`, `risk:low`, `ai/ready-for-work`
**Files:** `src-tauri/src/main.rs:1-4895`, `:4896-6944`

````markdown
## Summary

"Split up the 38 IPC commands" would buy about 13% of `main.rs` and leave the
actual weight untouched.

## Detail

The file is 6,944 lines, but **2,049 are inline test modules**
(`#[cfg(test)] mod native_transport_conformance_tests;` at :4896,
`native_transport_fixtures` at :4899, `mod tests` at :4902). Production is
4,895 lines.

`generate_handler!` at :4829 registers **38 commands**, and all 38 have a
matching `#[tauri::command]` attribute — zero orphaned or unregistered
commands, cross-checked in both directions.

The 32 handlers in `main.rs` total **637 body lines = 13.0%** of production
code, and only two exceed 30 lines (:4040 at 132 lines, :2964 at 82). The
other **87% (4,258 lines, 157 helper functions)** is transport and session
lifecycle:

| Function | Lines |
|---|---|
| `run_jump_host_session_loop` | 244 |
| `run_external_command_session_loop` | 231 |
| `copy_key_to_host_blocking` | 180 |
| `build_app_menu` | 145 |
| `main` | 144 |
| `run_native_session_loop` | 138 |
| `build_protocol_runtime_status` | 122 |

## Fix

Do not split by command. Split by transport: move the three session loops,
`copy_key_to_host_blocking`, and `build_protocol_runtime_status` into
`src-tauri/src/session_runtime.rs` and `src-tauri/src/ssh_config.rs`,
mirroring the existing `sftp.rs` precedent — 195 lines, 6 commands, no
handler over 20 lines.

## A note on `expect()` counts

If you see a figure of "181 `expect()` in `main.rs`" quoted anywhere, ignore
it. Recounting at the `#[cfg(test)]` boundaries:

| Region | `expect()` | `unwrap()` |
|---|---|---|
| `main.rs` 1-3684 (production) | **2** | **0** |
| `main.rs` 3685-4903 (test modules) | 40 | 0 |
| `main.rs` 4903-6944 (inline tests) | 139 | 0 |

Crate-wide production totals: **2 `expect()`, 0 `unwrap()`**. The 181 figure
counts inline test assertions.

## Confidence

Confirmed. The production/test split and the `expect()` counts were verified
directly.
````

---

## MAINT-9 — The Node backend's extraction never reached the parity-critical core

**Title:** `refactor: extract the SSH session and SFTP operations out of backend.mjs and replace the if-chain router`
**Labels:** `enhancement`, `risk:medium`, `ai/ready-for-work`
**Files:** `apps/desktop/server/backend.mjs`

````markdown
## Summary

The eleven `backend-*.mjs` modules total 1,027 lines and none exceeds 200.
What stayed behind in `backend.mjs` is **33 functions / 995 lines**, and it
includes the two behaviours most likely to drift.

## Detail

`backend.mjs` is 1,644 lines. The extracted modules are *helpers* — path
resolution, shell quoting, deadlines, buffers, responses. Still monolithic:

| Function | Lines |
|---|---|
| `createSshSession` | 118 |
| `generateKeyPair` | 89 |
| `createConnectConfig` | 84 |
| `sendRemoteFile` | 63 |
| `uploadRemoteFile` | 57 |
| `runRemoteCommand` | 56 |
| `globSshConfigFiles` | 55 |
| `createRemoteForward` | 54 |
| `createLocalForward` | 50 |
| `scanKnownHost` | 37 |
| `listRemoteDirectory` | 36 |

Plus a **321-line if-chain router** (`backend.mjs:1179-1499`, 22 sequential
`if (request.method === … && url.pathname === …)` checks).

## Fix

Extract `backend-ssh-session.mjs` (`createSshSession` +
`createConnectConfig` + `openJumpSocket` + `connectClient`, ~300 lines) and
`backend-sftp-ops.mjs`; convert the router to a `Map<"METHOD /path", handler>`
table.

## Confidence

Confirmed by the reviewer.
````

---

## MAINT-10 — Two host-key trust stores with no documented bridge

**Title:** `docs: explain how the frontend known-hosts inventory and the native pin store relate`
**Labels:** `documentation`, `risk:low`, `ai/in-refinement`
**Files:** `src-tauri/src/main.rs:4807`, `apps/desktop/src/store/known-hosts-store.ts`, `apps/desktop/src/lib/ensure-trusted-host-key.ts:95`

````markdown
## Summary

Two different models of "trusted" exist — a user-approved inventory in the
frontend, and an auto-populated pin store in the native shell — and nothing
documents how they relate.

## Detail

`NativeHostKeyStore::new(&data_dir)` lives in the Tauri app-data directory and
is what the native transport verifies against (`:1477`, `:1539`). The frontend
keeps a separate localStorage inventory;
`apps/desktop/src/lib/ensure-trusted-host-key.ts:95` persists a user approval
**only** to `useKnownHostsStore.trustKnownHost(...)`.

`terminal_workspace_scan_known_host` (`:3048`) only scans; it does not pin.
The native store's `append_pin` is reached from `copy_key_to_host_blocking`
(`:2679`) and `create_backend_session` (`:4045`) — it pins on a successful
connect, **not** on trust approval.

## Why it matters

Whether the two can disagree (frontend says trusted, native store holds a
different key → `HostKeyMismatch`) is exactly the class of bug the
`HostKeyMismatch` code exists for.

## Fix

Document the relationship in `docs/architecture.md` and add one test that
approves trust in the UI and then connects natively, asserting the two stores
agree.

## Note

The mechanism is confirmed; the failure mode was **not** traced end to end.
Needs a design conversation about which store is authoritative, so this is
`ai/in-refinement`.

## Confidence

Likely — mechanism confirmed, impact not yet proven.
````

---

## MAINT-11 — The `term-snip` rename left runtime identifiers behind

**Title:** `chore: retire the remaining legacy term-snip runtime identifiers`
**Labels:** `enhancement`, `risk:low`, `ai/in-refinement`
**Files:** `src-tauri/src/main.rs:58,64,69,75,722,747,759,784`, `apps/desktop/server/backend.mjs:71,81`, `.env.example:2-4`, `package.json:51-52`, `playwright.config.ts:21`

````markdown
## Summary

Commit `a036495` swept the `term-snip` name out of the UI defaults, docs and
tests, but left it in the **runtime** identifiers — the keychain service
names, the environment variables, the auth header, and the log prefixes.

## Detail

A case-insensitive search for `TERMSNIP|termsnip|term-snip` returns 80+
matches. The remaining runtime-visible ones:

- keychain service names `com.termsnip.runtime.*` (`src-tauri/src/main.rs:58,64,69,75`)
- `TERMSNIP_TELNET_PATH` / `SCREEN_PATH` / `CU_PATH` / `MOSH_PATH` (`main.rs:722,747,759,784`)
- `TERMSNIP_BACKEND_PORT`, `TERMSNIP_ALLOWED_ORIGINS` (`backend.mjs:71,81`)
- the `x-termsnip-token` header (`auth.mjs:29`)
- the `[termsnip]` log prefixes and the `__termsnipGuarded` viewport hack
- `scripts/backend-transport-test.sh:168-169` exports **both**
  `TERMSNIP_BACKEND_TOKEN` and `TW_BACKEND_TOKEN`

## ⚠️ Do NOT rename these

- The keychain service strings **must not** change — they are the on-disk
  identity of existing installs.
- `src-tauri/src/main.rs:393` (`LEGACY_DATABASE_URL = "sqlite:termsnip.db"`) is
  a deliberate migration source.
- The `TermSnip` / `term-snip` bundle names in
  `apps/desktop/src/lib/local-config.test.ts:711,738` are intentional
  import-compatibility cases.
- The frontend's storage key was correctly migrated to
  `terminal-workspace-app` (`store/app-store.ts:238`) while the old key is
  still read as legacy.

## Fix

- Freeze the keychain and database identifiers behind an explicit
  *"do not rename — compatibility identity"* comment block at
  `src-tauri/src/main.rs:58-75`.
- Add `TERM_WORKSPACE_*` aliases alongside the `TERMSNIP_*` names with a
  deprecation window.
- Leave the legacy bundle readers alone.

## Note

Needs a deprecation-window decision, so `ai/in-refinement`.

## Confidence

Confirmed.
````

---

## MAINT-12 — Two genuinely dead exports, and 61 over-exported symbols

**Title:** `chore: remove the dead exports and demote the file-local type exports`
**Labels:** `enhancement`, `risk:low`, `ai/ready-for-work`
**Files:** `apps/desktop/src/types/host.ts:362`, `apps/desktop/src/lib/identity-migration.ts:206`

````markdown
## Summary

Two exports have no references anywhere in the repository, and 61 exported
symbols are used only inside their own file.

## Detail

- `hostSupportsRemoteSnippets` is referenced nowhere. Its siblings
  `hostSupportsPortForwarding` and `hostSupportsCredentialPrompt` are used.
- `__sampleMigrationInput` — an exported fixture — is referenced nowhere,
  including its own test.

A full export-usage scan over `apps/desktop/src/**` plus `tests/**`
(colocated `*.test.ts` included) found **61 exported symbols with zero
references outside their own file**. Most are types used only internally, so
this is an inflated public surface rather than dead code.

## Fix

Delete the two dead exports; demote the roughly 40 type-only exports to
non-exported where they are file-local.

## Confidence

Confirmed by the reviewer.
````

---

## MAINT-13 — `docs/architecture.md` has no module map

**Title:** `docs: add a module map to docs/architecture.md`
**Labels:** `documentation`, `risk:low`, `ai/ready-for-work`
**Files:** `docs/architecture.md`

````markdown
## Summary

The one document a new contributor opens does not tell them where a behaviour
lives, which is the actual cost of a two-backend codebase.

## Detail

`docs/architecture.md` is 19 lines: four bullets, and no file names beyond
three Rust modules. It omits:

- `ipc_types.rs` (606 lines, the shared wire types)
- `ipc_error.rs` (the typed error contract)
- `native_host_keys.rs`
- `sftp.rs`
- the frontend's transport-abstraction layer (`lib/backend-runtime.ts`,
  `lib/api.ts`, `lib/backend-contract.ts`)

## Fix

Add a module table: path → responsibility → which Rust counterpart owns it.

## Confidence

Confirmed — the file is 19 lines.
````

---

## MAINT-14 — The shell preamble is duplicated across 23 scripts

**Title:** `chore: source a shared bootstrap from the shell scripts`
**Labels:** `enhancement`, `risk:low`, `ai/backlog`
**Files:** `scripts/*.sh`

````markdown
## Summary

23 of 25 scripts reproduce `cd "$(dirname "${BASH_SOURCE[0]}")/.."`, and 15
also define `ROOT_DIR=`.

## Why it matters: marginal

Each script is 50-375 lines and independently readable, so the cost is a few
lines per script, not per change.

## Fix

Optional. A sourced `scripts/_bootstrap.sh` would centralise it; not worth a
dedicated pull request.

## Confidence

Confirmed by the reviewer.
````

---

## MAINT-15 — CI and shell scripts are in better shape than expected *(strength)*

**Title:** _(no action — recorded so the next reviewer does not re-audit it)_
**Labels:** _(none)_

````markdown
## Note

`validate.yml` is 433 lines across **three named jobs** (`validate` :26,
`rust-validate` :106, `native-ssh-fixtures` :335) with 25 individually named
steps — a readable pipeline, not a monolith.

**23 of 25** `scripts/*.sh` use `set -euo pipefail`; the sole exception is
`scripts/load-env.sh`, which is a sourced library where `set -e` would be
wrong.

`scripts/validate.sh` is 375 lines of which 112 are comments — and those
comments record *why* each gate exists. `:79-91` explains that a
reader-thread fix was wrong, a green local suite, and a CI timeout that read
as infrastructure failure. That is the kind of institutional memory most
projects lose.

## Confidence

Confirmed.
````

---

# Part 3 — Usability

---

## UX-1 — Every connect failure message is computed, then thrown away

**Title:** `bug: a connect failure produces no on-screen output anywhere in the app`
**Labels:** `bug`, `risk:medium`, `ai/ready-for-work`
**Files:** `apps/desktop/src/lib/launch-host-session.ts:61` → 7 call sites

````markdown
## Summary

The most common failure in an SSH client produces no user-visible output at
all. The message is computed correctly and then discarded to `console.warn`.

## Detail

`launchHostSession` returns `{ ok: false, errorMessage }` with good, actionable
copy — *"Could not scan `host:port`. Check that the host is reachable and try
again."* Every call site throws it away:

| Surface | Call site |
|---|---|
| Hosts page — open host | `apps/desktop/src/routes/HostsPage.tsx:144` |
| Hosts page — quick connect | `apps/desktop/src/routes/HostsPage.tsx:193` |
| Sidebar — local terminal | `apps/desktop/src/components/layout/Sidebar.tsx:110` |
| Sidebar — recent hosts | `apps/desktop/src/components/layout/Sidebar.tsx:228` |
| Sidebar — pinned hosts | `apps/desktop/src/components/layout/Sidebar.tsx:275` |
| Command palette | `apps/desktop/src/components/layout/use-command-palette-rows.ts:124` |
| First-run welcome panel | `apps/desktop/src/components/hosts/WelcomePanel.tsx:34` |

Each is `console.warn(...)` and nothing else. A host that is down,
firewalled, or mis-typed therefore looks exactly like a broken app: the user
clicks **Open**, no tab appears, no toast, no banner.

The hosts page even carries a comment acknowledging it — *"surface a
non-blocking banner via console for now; future polish ticket can route this
through a global toast."*

## Fix

Every one of those entry points funnels through `launchHostSession`, so
publish the failure **there** rather than at each call site. That guarantees it
reaches the screen no matter which surface raised it, and it cannot drift when
a new call site is added.

- A small store holds the message and a dismissible banner renders it from the
  app shell, next to the preview and update banners.
- A user-rejected host key should be reported as a **warning**, not an error —
  the user chose it.
- A successful connect should clear a stale failure, so a banner never
  outlives the problem it described.
- Keep the `console.warn` at each call site: it carries the surface name and
  is useful for debugging.

**No user-facing message string needs to change** — the existing copy is
already right.

## Note

While you are in `launch-host-session.ts`: a **throwing** `ensureTrustedHostKey`
currently rejects out of the function. None of the seven call sites have a
`try/catch`, so that surfaces as an unhandled promise rejection with nothing
on screen. Catching it and resolving with `ok: false` would close that hole
too — and it changes the function's contract, so update the mutex test that
asserts the old rejection.

## Confidence

Confirmed — all seven call sites were checked directly.
````

---

## UX-2 — Internal engineering notes ship in the Settings page

**Title:** `bug: the Settings page shows internal engineering notes as user-facing copy`
**Labels:** `bug`, `documentation`, `risk:low`, `ai/ready-for-work`
**Files:** `apps/desktop/src/routes/SettingsPage.tsx:372-397`

````markdown
## Summary

The Settings page renders the project's own planning vocabulary as if it were
product copy, including a ticket ID.

## Detail

The `<aside>` renders verbatim to end users:

> *"Cloud sync, shared vaults, and team features are still intentionally
> outside the 90% local-first target. The immediate focus is making a single
> Mac fully replace daily alternative client usage."*

> *"Browser and screenshot flows still default to demo mode. The native shell
> now defaults to live transport so local testing starts against the real
> Tauri-backed connection path."*

> *"…so seeded demo and screenshot flows stay stable."*

A ticket ID (`P2-DM1`) appears in the shipped UI.

Separately, the "Reusable identities" blurb at `:159-164` first promises
*"Editing the identity once propagates to every host that adopts it"* and then
admits it does not — a feature description for unshipped behaviour.

## Fix

- Delete the `<aside>`. The user-facing facts it described — what native mode
  covers, how config imports preview a snapshot, how remote sync trust policy
  works — are already covered by the settings sections themselves.
- The layout is a two-column grid (`xl:grid-cols-[1.2fr_0.9fr]`) with the
  aside as the second column, so removing it leaves an empty column: make the
  section single-column and cap the content width so it does not stretch.
- Rewrite the identities blurb to describe actual current behaviour.

## Confidence

Confirmed by reading the file.
````

---

## UX-3 — The delete-host dialog misstates what deletion does

**Title:** `bug: the delete-host dialog misstates its blast radius`
**Labels:** `bug`, `risk:low`, `ai/ready-for-work`
**Files:** `apps/desktop/src/routes/HostsPage.tsx:557`, `apps/desktop/src/store/cascade-actions.ts:12-32`

````markdown
## Summary

The confirmation dialog describes one of the six things the delete actually
does, and gets that one wrong.

## Detail

The dialog says:

> *"This removes the host from the local inventory. **Existing tabs close on
> refresh**, and any trusted host key or assigned identity remains in local
> storage until you remove it separately."*

But `deleteHostAndCascade` (`apps/desktop/src/store/cascade-actions.ts:12-32`)
does six things:

| What the cascade does | Old copy |
|---|---|
| Deletes the host | ✅ stated |
| **Wipes the host's saved credentials** (`clearHostSecrets`) | ❌ not mentioned |
| Unassigns the host from every key | ❌ not mentioned |
| **Removes the host from every snippet's target list** (`removeHostFromAllTargets`) | ❌ not mentioned |
| **Closes the panes and their backend sessions — now, not "on refresh"** (`closePanesForHost`) | ❌ stated as "on refresh" |
| Clears the active transfer context | ❌ not mentioned |

`closePanesForHost` calls `closeBackendSessionsForPanes` immediately
(`apps/desktop/src/store/sessions-store.ts:711-718`), not on refresh.

The trusted-host-key entry genuinely does survive, so the copy should still say
what is kept: the trusted host key and the identity both stay, with the host
unassigned from them.

## Fix

Rewrite the description to name the real effects. Consider making the
credential wipe a separate, separately-confirmed step.

## Confidence

Confirmed — the dialog copy and the full cascade body were both read.
````

---

## UX-4 — "Load sample data" silently converts the whole app into a mock

**Title:** `bug: Load sample data silently switches the app into demo mode with no visible indicator`
**Labels:** `bug`, `risk:medium`, `ai/ready-for-work`
**Files:** `apps/desktop/src/components/hosts/WelcomePanel.tsx:44-52`, `apps/desktop/src/store/app-store.ts:246`, `apps/desktop/src/components/terminal/use-terminal-pane-session.ts:130`

````markdown
## Summary

A new user who clicks "Load sample data" ends up in a permanently mocked app,
and the only warning is one line buried in terminal scrollback that reads like
a feature.

## Detail

`handleTrySampleData` calls `setDemoModeEnabled(true)` then `loadSampleData()`.
`demoModeEnabled` is **persisted** (`apps/desktop/src/store/app-store.ts:246`),
and `apps/desktop/src/components/terminal/use-terminal-pane-session.ts:130`
computes:

```ts
const useMockTransport = demoModeEnabled || (protocol === "ssh" && authMethod === "none");
```

so every subsequent connection to a real host is simulated by
`terminal-pane-mock-session.ts`, which fabricates command output.

The only warning is one line in terminal scrollback: *"Demo mode keeps
commands local while the UI remains fully interactive."*

## Fix

- Show a persistent, dismissible "Demo mode" banner in the app chrome
  whenever `demoModeEnabled` is true — **in every runtime**, not just the
  browser (see UX-23).
- Rename the action to `Load sample data (demo mode)` and give it a `title`
  that says connections are simulated.

## Confidence

Confirmed — the persisted flag → mock-transport chain was traced.
````

---

## UX-5 — The add-host submit button is disabled with no reason

**Title:** `bug: the host editor disables submit with no explanation of what is missing`
**Labels:** `bug`, `risk:low`, `ai/ready-for-work`
**Files:** `apps/desktop/src/components/hosts/HostEditor.tsx:116-119,214,227-229`

````markdown
## Summary

The user leaves a required field blank, and the form's submit button is
greyed out with no indication of what is missing or which field is at fault.

## Detail

`isInvalid` gates the button (`disabled={isInvalid}`) and the form's
`onSubmit` early-returns (`:227-229`). There is **no** inline error, **no**
`aria-invalid`, **no** `aria-describedby`, **no** `required` attribute, and
**no** `title` on the button. A grep for `aria-invalid` and `required` across
`HostEditor.tsx` returns nothing.

The **port field is not validated at all**, so a typo'd port only surfaces
later as a connect failure — which, per UX-1, was itself invisible.

## Fix

- Give each required field an inline error message, with `aria-invalid` and
  `aria-describedby` pointing at it.
- State in the footer how many fields still need attention, so the reason is
  visible even when the offending field is scrolled out of view.
- Validate the port field: it must be an integer, and 1–65535. Note that
  **serial uses that field as a baud rate**, so it must be range-checked
  separately rather than against the TCP port range that would reject the
  serial default of 115200. A local shell has no network port at all and
  never renders the field.

## Confidence

Confirmed by the reviewer.
````

---

## UX-6 — Snippet broadcast failure is completely silent

**Title:** `bug: a failed snippet broadcast leaves no on-screen error`
**Labels:** `bug`, `risk:low`, `ai/ready-for-work`
**Files:** `apps/desktop/src/routes/SnippetsPage.tsx:115-150,263`

````markdown
## Summary

Running a snippet across several hosts and having it fail produces no error
whatsoever.

## Detail

`broadcastToHosts` has `try { … } finally { setBroadcastBusy(false) }` — **no
`catch`** — and is invoked as `onClick={() => void broadcastToHosts()}`. Any
rejection from `executeSnippetOnHosts` (`:139`) becomes an unhandled
rejection; `setBroadcastResults` is never called, `broadcastBusy` resets, and
the user sees the button return to idle with no result panel and no error.

The one branch that can fail silently is `ensureRuntimeSecrets` returning
`false` (`:128-130`), which also returns without a message.

## Fix

Add a `catch` that sets a `broadcastError` string, and render it next to
`broadcastResults` with `role="alert"`.

## Confidence

Confirmed by the reviewer.
````

---

## UX-7 — Browser mode leaks raw JSON error bodies into the UI

**Title:** `bug: browser mode shows raw JSON error bodies to the user`
**Labels:** `bug`, `risk:low`, `ai/ready-for-work`
**Files:** `apps/desktop/src/lib/api.ts:79-82`, `apps/desktop/src/lib/backend-runtime.ts:487-490`, `apps/desktop/src/components/sftp/FileBrowser.tsx:135,273,301,339,376`

````markdown
## Summary

The same failure reads as a sentence in native mode and as raw JSON in
browser mode.

## Detail

The Node backend deliberately returns a safe generic body —
`sendJson(response, statusCode, { error: message })` with
`message = "Internal server error."` — but the client does
`throw new Error(await response.text())`, so `error.message` is the literal
string `{"error":"Internal server error."}`.

`FileBrowser` renders `error.message` verbatim, so the user sees raw JSON in
a rose banner. Native mode returns a typed error and looks fine.

## Fix

Parse the JSON body in `browserFetchJson` and throw
`new Error(body.error ?? \`Backend request failed: ${status}\`)`; route
`FileBrowser` through the existing `formatBackendFailure` helper
(`apps/desktop/src/lib/backend-failure-messages.ts:75`).

## Confidence

Confirmed by the reviewer.
````

---

## UX-8 — Session-restore failure shows a bare "error" badge

**Title:** `bug: a failed session restore shows only the word "error"`
**Labels:** `bug`, `risk:low`, `ai/ready-for-work`
**Files:** `apps/desktop/src/components/terminal/SessionRestoreManager.tsx:80-83,87-91`, `apps/desktop/src/types/session.ts:122-129`

````markdown
## Summary

Reopening the app with saved sessions and finding that one failed to restore
tells the user nothing about why.

## Detail

Both the promise `.catch()` and the `catch {}` block call
`setPaneState(pane.id, "error")` and discard the exception.
`formatSessionConnectionState` returns the raw state string, so the tab shows
the word `error` — no reason, no retry affordance, no hint that the host may
simply be down.

## Fix

Store the error text alongside the pane state (e.g. `pane.connectionError`) and
surface it in the tab tooltip and in a banner when the pane is focused.

## Confidence

Confirmed by the reviewer.
````

---

## UX-9 — Backend health is fetched by nobody

**Title:** `bug: getSessionBackendStatus has no call sites, so a dead backend looks like an empty inventory`
**Labels:** `bug`, `risk:low`, `ai/ready-for-work`
**Files:** `apps/desktop/src/lib/backend-runtime.ts:516-522`

````markdown
## Summary

In browser mode, if the Node backend is down, every list renders as empty with
no explanation — and the user cannot tell "no hosts" from "no server".

## Detail

`getSessionBackendStatus()` is defined and exported but has **zero call sites**
outside its own definition.

## Fix

Call it once at app start in browser mode and render a persistent banner when
the backend is unreachable.

## Confidence

Confirmed by the reviewer.
````

---

## UX-10 — "Run next step" is a dead-end button whose explanation is unreachable

**Title:** `bug: the runbook Run next step button is permanently disabled with the explanation unreachable`
**Labels:** `bug`, `risk:low`, `ai/ready-for-work`
**Files:** `apps/desktop/src/routes/RunbooksPage.tsx:370,149-159,394`

````markdown
## Summary

A permanently greyed-out button with no tooltip and no visible explanation.

## Detail

The button is `disabled={!activePane || runbookFinished}`. The explanatory
string *"Nothing was queued: open a session pane, or reset the runbook."* is
only set inside `handleRunNextStep` (`:158`) — which cannot run when the
button is disabled. So in exactly the case the message was written for, the
message never appears. There is no `title` attribute either.

## Fix

When `!activePane`, render the explanation unconditionally (not via
`runStatus`), or add `title="Open a session pane first"`.

## Confidence

Confirmed by the reviewer.
````

---

## UX-11 — Port and hostname are not validated

**Title:** `bug: the host form does not validate the port field`
**Labels:** `bug`, `risk:low`, `ai/ready-for-work`
**Files:** `apps/desktop/src/components/hosts/HostEditor.tsx`

````markdown
## Summary

A non-numeric or out-of-range port passes validation and fails later, at
connect time — where, per UX-1, the failure was invisible.

## Detail

`isInvalid` (`:116-119`) covers label, hostname and username only.

## Fix

Validate the port as an integer 1–65535 inline, with a separate range for
serial baud rates. Covered by the broader validation work in UX-5.

## Confidence

Confirmed by the reviewer.
````

---

## UX-12 — Modals have no focus management at all

**Title:** `a11y: modals do not move focus, trap Tab, or restore focus`
**Labels:** `bug`, `risk:low`, `ai/ready-for-work`
**Files:** `apps/desktop/src/components/common/Modal.tsx:65-93`

````markdown
## Summary

Every dialog in the app is unusable with a keyboard in the way a dialog is
supposed to be.

## Detail

`Modal` renders `role="dialog" aria-modal="true"` (`:87-88`) but never moves
focus into the dialog on open, never traps Tab inside it, and never restores
focus to the trigger on close. Focus stays on the button behind the scrim, so
a keyboard user's next Tab may land on page content behind the overlay.

The only focus-related attribute in the file is `aria-label="Close dialog"` on
the backdrop button (`:73`) — the *first* tabbable element in the DOM and a
full-screen invisible target.

## Fix

On open, focus the first focusable child (or the dialog frame with
`tabIndex={-1}`); add a Tab / Shift+Tab trap; restore focus to the trigger on
close.

## Confidence

Confirmed by the reviewer.
````

---

## UX-13 — The command palette panel has no dialog semantics

**Title:** `a11y: the command palette has no dialog role or accessible name`
**Labels:** `bug`, `risk:low`, `ai/ready-for-work`
**Files:** `apps/desktop/src/components/layout/CommandPaletteDialog.tsx:50,57,77-104`

````markdown
## Summary

Assistive tech gets a bare input in a page, not a modal palette.

## Detail

The overlay container has no `role="dialog"`, no `aria-modal`, and no
`aria-label`. Only the backdrop button (`:50`) and the input (`:103`) are
labelled.

The input *is* focused on open (`apps/desktop/src/components/layout/AppShell.tsx:80`)
and `aria-activedescendant` is wired correctly, so keyboard operation is
otherwise sound.

## Fix

Add `role="dialog" aria-modal="true" aria-label="Command palette"` to the
palette container.

## Confidence

Confirmed by the reviewer.
````

---

## UX-14 — Right-clicking the terminal silently pastes the clipboard

**Title:** `bug: right-clicking the terminal pastes the clipboard with no menu and no confirmation`
**Labels:** `bug`, `risk:low`, `ai/ready-for-work`
**Files:** `apps/desktop/src/components/terminal/terminal-pane-input-wiring.ts:44-59`

````markdown
## Summary

A user who right-clicks expecting a menu instead pastes whatever is on their
clipboard into a live shell.

## Detail

The `contextmenu` handler calls `event.preventDefault()` and immediately does
`navigator.clipboard.readText().then(text => terminal.paste(text))`. There is
**no context menu** and **no confirmation**.

Both clipboard calls swallow errors with `.catch(() => {})` (`:41`, `:57`), so
if the webview denies clipboard access the feature fails silently.

## Fix

Render an actual context menu (Copy / Paste / Clear), and surface a "Copied"
toast for the selection-change copy at `:33-42`.

## Note

Clipboard-permission behaviour in the Tauri webview is unverified —
`src-tauri/capabilities/default.json` lists no clipboard permission, which is
a plausible secondary failure worth checking while you are in here.

## Confidence

Confirmed by the reviewer.
````

---

## UX-15 — Every dialog is unnamed for screen readers

**Title:** `a11y: dialogs have no accessible name`
**Labels:** `bug`, `risk:low`, `ai/ready-for-work`
**Files:** `apps/desktop/src/components/common/Modal.tsx:87-99`

````markdown
## Summary

A screen reader announces only "dialog" for every modal in the app.

## Detail

The dialog has `role="dialog" aria-modal="true"` but the `<h2>` title at
`:99` has no `id`, and the dialog has no `aria-labelledby` /
`aria-describedby`. The description at `:100` is likewise unassociated.

## Fix

Generate an id for the title and wire `aria-labelledby` / `aria-describedby`
to the title and description elements.

## Confidence

Confirmed by the reviewer.
````

---

## UX-16 — Error banners are not live regions

**Title:** `a11y: error banners are not announced to assistive tech`
**Labels:** `bug`, `risk:low`, `ai/ready-for-work`
**Files:** `apps/desktop/src/components/sftp/FileBrowser.tsx:542-546`

````markdown
## Summary

Errors are inserted into the DOM with plain `<div>`s, so a screen-reader user
who triggers a failure hears nothing.

## Detail

A grep for `role="alert"` and `aria-live` across `FileBrowser.tsx`,
`routes/SnippetsPage.tsx`, and `routes/HostsPage.tsx` returns zero matches.

The pattern does exist elsewhere — `components/keys/CopyKeyToHostDialog.tsx:120`
and `components/ErrorBoundary.tsx:30` both use `role="alert"` — so this is
inconsistent application, not a missing convention.

## Fix

Add `role="alert"` to each error banner.

## Confidence

Confirmed by the reviewer.
````

---

## UX-17 — Terminal output is not reachable by assistive technology

**Title:** `a11y: terminal output has no accessible representation`
**Labels:** `bug`, `risk:low`, `ai/ready-for-work`
**Files:** `apps/desktop/src/components/terminal/use-terminal-pane-lifecycle.ts:154-159`, `apps/desktop/src/components/terminal/terminal-pane-native-session.ts:147-149,187-189`

````markdown
## Summary

A blind or low-vision user driving a session cannot learn that a connection
dropped, that a fingerprint prompt appeared, or that a command finished.

## Detail

All session state, error text and reconnect notices are written into the
xterm canvas/buffer (`terminal.writeln`), which has no accessible
representation. The tab badge exposes only the bare state word
(`apps/desktop/src/types/session.ts:122-129`).

## Fix

Mirror session-level events (connected / disconnected / error / prompt) into
an `aria-live="polite"` region above the terminal, and expose the last N lines
of output as an accessible transcript.

## Confidence

Confirmed by the reviewer.
````

---

## UX-18 — Confirm dialogs display their description twice

**Title:** `bug: confirm dialogs show the same description twice`
**Labels:** `bug`, `risk:low`, `ai/ready-for-work`
**Files:** `apps/desktop/src/components/common/ConfirmDialog.tsx:65,89`, `apps/desktop/src/components/common/Modal.tsx:100`

````markdown
## Summary

The host-delete warning sentence appears twice, a few pixels apart.

## Detail

`ConfirmDialog` passes `description={description}` to `Modal`, which renders
it as a muted subtitle (`Modal.tsx:100`), and then renders the same string
again in the body (`ConfirmDialog.tsx:89`).

## Fix

Drop the duplicate `<p>` in `ConfirmDialog` and rely on the Modal's subtitle.

## Confidence

Confirmed by the reviewer.
````

---

## UX-19 — The destructive button is auto-focused, and there is no undo

**Title:** `bug: the destructive confirm button takes focus by default and deletion cannot be undone`
**Labels:** `bug`, `risk:low`, `ai/ready-for-work`
**Files:** `apps/desktop/src/components/common/ConfirmDialog.tsx:78-85`

````markdown
## Summary

A user who reflexively presses Enter to dismiss a dialog performs the
deletion immediately.

## Detail

The rose destructive button carries `autoFocus`. Because the Modal has no
focus trap (UX-12) and no visible "press Enter to confirm" hint, Enter
triggers the delete.

There is also **no undo anywhere in the codebase** — a grep for `undo` /
`Undo` across `apps/desktop/src` returns zero hits — so deletion is
irreversible with no recovery path.

## Fix

Move `autoFocus` to the Cancel button for destructive dialogs (or to the
dialog frame), and add an "Undo" toast after a deletion.

## Confidence

Confirmed by the reviewer.
````

---

## UX-20 — Reconnect retries forever with no attempt cap

**Title:** `bug: reconnect retries indefinitely with no give-up state`
**Labels:** `bug`, `risk:low`, `ai/ready-for-work`
**Files:** `apps/desktop/src/components/terminal/terminal-pane-native-session.ts:124-159`, `apps/desktop/src/components/terminal/connect-failure-policy.ts:13-21`

````markdown
## Summary

A host that stays down produces a terminal line every 8 seconds, indefinitely.

## Detail

`scheduleReconnect` increments `reconnectAttemptRef` with no maximum and a
delay capped at 8 s (`:140-143`). The pane badge flaps
`disconnected → connecting → disconnected`. The only escape is the Disconnect
button; there is no "giving up after N attempts" state and no attempt counter.

`connect-failure-policy.ts` correctly excludes host-key mismatches from retry,
but nothing bounds ordinary failures.

## Fix

Cap attempts (e.g. 5) with exponential backoff, then land in a terminal
`disconnected` state with a "Retry" button and the last error.

## Confidence

Confirmed by the reviewer.
````

---

## UX-21 — Scrollback is left at the xterm default

**Title:** `bug: terminal scrollback is left at xterm's 1000-line default`
**Labels:** `bug`, `risk:low`, `ai/ready-for-work`
**Files:** `apps/desktop/src/components/terminal/use-terminal-pane-lifecycle.ts:154-159`

````markdown
## Summary

On a busy host the scrollback is silently truncated long before the user
scrolls back to find what they need.

## Detail

`new Terminal({ cursorBlink, fontFamily, fontSize, theme })` sets no
`scrollback` option, so xterm.js uses its 1000-line default. A native
terminal typically keeps 10,000+.

## Fix

Set `scrollback: 10000`, and consider a persisted per-session buffer size.

## Note

The code is confirmed; the real-world impact was not measured against a live
session.

## Confidence

Confirmed in code; impact likely.
````

---

## UX-22 — Connection errors exist only inside scrollback

**Title:** `bug: a connection error is only visible in scrollback, not in the pane chrome`
**Labels:** `bug`, `risk:low`, `ai/ready-for-work`
**Files:** `apps/desktop/src/components/terminal/terminal-pane-native-session.ts:187-189,147-149`

````markdown
## Summary

The terminal-side twin of UX-1.

## Detail

The error text is written into the terminal buffer, not into the pane chrome.
The pane badge shows only the bare state word. If the user scrolls down — or
is looking at the tab strip — there is no visible reason.

## Fix

Promote the last connection error into the pane header as a dismissible
inline notice, keeping the terminal copy as detail.

## Confidence

Confirmed by the reviewer.
````

---

## UX-23 — Demo mode has no indicator in the native app

**Title:** `bug: the native app shows no demo-mode indicator`
**Labels:** `bug`, `risk:medium`, `ai/ready-for-work`
**Files:** `apps/desktop/src/components/common/PreviewBanner.tsx:3-12`, `apps/desktop/src/routes/SettingsPreferencesSection.tsx:104-107`

````markdown
## Summary

In the native app, a user in demo mode has no way to know it.

## Detail

`PreviewBanner` returns `null` when `isTauriRuntime()` is true:

```tsx
export function PreviewBanner() {
  if (isTauriRuntime()) {
    return null;
  }
  return (
    <div className="border-b border-amber-300/40 …">
      Preview only - Tauri native ship runs without this backend.
    </div>
  );
}
```

The only control is a toggle buried in Settings → Preferences. A user in the
native app can run an entire "successful" workflow against fake output without
knowing it — see UX-4.

## Fix

Render a demo-mode banner in **every** runtime whenever `demoModeEnabled` is
true, independent of `PreviewBanner`. `PreviewBanner` is about the preview
*backend*; demo mode is a distinct state that applies to both runtimes.

## Confidence

Confirmed by reading the file.
````

---

## UX-24 — Error text quality differs sharply between runtimes

**Title:** `bug: the same failure reads as a sentence natively and as raw JSON in browser mode`
**Labels:** `bug`, `risk:low`, `ai/ready-for-work`
**Files:** `apps/desktop/src/lib/api.ts:79-82`, `apps/desktop/src/lib/backend-runtime.ts:224-234`

````markdown
## Summary

The two runtimes do not present the same error the same way.

## Detail

Native mode gets a typed Tauri error; browser mode gets
`new Error(rawJsonBody)` (UX-7). The same SFTP failure reads as a readable
sentence in one mode and as raw JSON in the other.

## Fix

Normalise at the `api.ts` layer so both runtimes throw the same shaped
error, and format once in the component.

## Confidence

Confirmed by the reviewer.
````

---

## UX-25 — "Open a local terminal" dead-ends on failure

**Title:** `bug: Open a local terminal fails silently in the welcome panel`
**Labels:** `bug`, `risk:low`, `ai/ready-for-work`
**Files:** `apps/desktop/src/components/hosts/WelcomePanel.tsx:32-42`

````markdown
## Summary

On the first-run screen, the failure path does nothing observable.

## Detail

On failure the handler only does
`console.warn(\`[welcome] ${result.errorMessage}\`)` and returns. No tab
opens, no error appears, no navigation happens. The user's only feedback is
that the click did nothing.

## Fix

Covered by the shared banner work in UX-1.

## Confidence

Confirmed.
````

---

# Part 4 — Already sound, do not re-audit

These were checked and are **not** problems. Recording them so the next
review does not spend its budget there.

## Security

- **The ssh_config injection guard.** `reject_control_chars`
  (`src-tauri/src/main.rs:828-833`) is applied to hostname / username / key
  path before `HostName` / `User` are written verbatim
  (`src-tauri/src/native_transport.rs:1072-1075`), with a regression test at
  `src-tauri/src/main.rs:6227-6240`.
- **Remote command quoting.** `shell_single_quote` / `shellSingleQuote`
  (`apps/desktop/server/backend-shell.mjs:22-24`,
  `src-tauri/src/native_transport.rs`), used for `sh -lc`
  (`native_transport.rs:1789`); environment keys restricted to shell
  identifiers (`backend-shell.mjs:27-29`).
- **Native host-key verification.** `verify_native_host_key` runs pre-auth
  (`main.rs:1474-1520`); a durable TOFU store with a cross-process lock,
  symlink refusal, and fail-closed behaviour on an unknown algorithm
  (`native_host_keys.rs:144-190`).
- **OpenSSH fallback pinning.** `StrictHostKeyChecking yes` when pinned,
  `accept-new` (never `no`) otherwise; `GlobalKnownHostsFile /dev/null`,
  `UpdateHostKeys no`, `HashKnownHosts no` (`native_transport.rs:1084-1130`).
- **known_hosts pattern** includes the port for non-22
  (`native_transport.rs:649-655`), matching OpenSSH semantics.
- **Every backend route and the WebSocket upgrade are behind
  `isRequestAuthorized`** (`backend.mjs:1194-1202`, `backend.mjs:1515-1526`);
  no route is registered before the gate; the backend binds `127.0.0.1` only
  (`backend.mjs:1642`).
- **Local path containment.** `resolvePathInsideRoot` uses component-aware
  `relative()` plus `realpath` on both root and target, defeating prefix and
  symlink escapes (`apps/desktop/server/backend-paths.mjs:31-60`);
  `validate_user_owned_key_path` canonicalises and roots-checks
  (`native_transport.rs:33-101`).
- **Remote path normalisation.** The identical clamp-at-root algorithm on
  both backends, pinned by a shared conformance corpus
  (`native_transport.rs:110-122`, `backend-paths.mjs:74-90`); download
  filenames are sanitised (`backend-paths.mjs:125-127`).
- **Keychain secret handling.** Secrets are written to `/usr/bin/security` via
  stdin, never argv (`keychain_support.rs:544-590`); reads use `-w` to stdout
  (`keychain_support.rs:631-636`); errors are formatted without the secret.
- **Node secret scrubbing.** `SecretBuffer` with a post-connect wipe of the
  password / passphrase / key copies (`backend.mjs:300-353`).
- **CI.** Actions are SHA-pinned; `permissions: contents: read`;
  `persist-credentials: false`; no `pull_request_target`; `${{ github.event.* }}`
  reaches scripts via `env:`, never interpolated into `run:`
  (`validate.yml:49-57`, `release-macos.yml:54-60`); the signing job is
  deliberately excluded from the PR-execution runner pool
  (`release-macos.yml:27-35`).
- **Local command execution.** `ssh-keyscan` / `ssh` / `ssh-keygen` are
  invoked with argument vectors, never a shell string.

## Maintainability

- **No orphaned IPC commands.** All 38 `#[tauri::command]` functions are
  registered in `generate_handler!` (`main.rs:4829`), and every registered
  name resolves to a real attribute — cross-checked clean in both
  directions.
- **Rust production code contains essentially no `unwrap` / `expect`.**
  Crate-wide production totals: 2 `expect()`, 0 `unwrap()`. See MAINT-8 for
  the correct breakdown.
- **The typed-error design is right, and the frontend honours it.**
  `ipc_error.rs` defines a stable `code` vocabulary that deliberately
  matches the frontend classifier's category names, and
  `ssh-error-classifier.ts:107-125` reads `error.code` first, falling back to
  regex. The gap is coverage, not design.
- **A real cross-backend conformance harness exists and is well built.**
  `tests/fixtures/security-helper-conformance.json` is hand-authored rather
  than captured from either side — the file explicitly says a golden taken
  from one backend *"would have blessed exactly those bugs"* — and both
  `native_transport_conformance_tests.rs` and
  `security-helper-conformance.integration.test.ts` execute it, with
  `cases()` asserting every group is non-empty so a suite cannot pass
  vacuously. The `quoted_values_round_trip_through_a_real_shell` test
  (`native_transport_conformance_tests.rs:306`) proves the *spelling* through
  an actual `/bin/sh`.
- **Test colocation is real, not aspirational.** 121 colocated
  `*.test.ts(x)` files against 137 source files; every `backend-*.mjs` module
  has a matching integration test; `local-config.ts` (960 lines) carries 790
  lines of tests including legacy-bundle migration cases.
- **Rust test code is roughly 45% of Rust** (~7,219 test lines vs ~8,666
  production), and the inline `#[cfg(test)]` modules live in a dedicated tail
  of `main.rs` (`:4896-6944`) rather than interleaved with production code.
- **Every `#[tauri::command]` returns a `Result`** or is trivially
  infallible — 3 commands are non-`Result`, and none of the 35 fallible ones
  panics on a user-reachable path.
- **The dependency manifests are exemplary.** `Cargo.toml` documents *why*
  `macos-private-api` is needed and prices its two costs (App Store
  ineligibility, no ABI stability guarantee); `tauri-plugin-sql` is pinned to
  `=2.6.0` with a comment naming the wrapper path that would break.
  `pnpm-workspace.yaml` enables `trustPolicy: no-downgrade` and
  `minimumReleaseAge: 10080`, and its two exclusions carry a dated,
  per-advisory rationale with an explicit deletion condition.
- **The ESLint config is targeted.** `eslint.config.mjs` ignores exactly what
  should be ignored, with a comment explaining that the `orc claim`
  worktree probe previously produced 536 parse errors on untouched files.
- **`scripts/validate.sh` documents why each gate exists, not just what it
  runs.** See MAINT-15.
- **Shell strict mode is near-universal and correctly scoped.** 23 of 25
  scripts use `set -euo pipefail`; the one exception is the sourced env
  loader, where `set -e` would be incorrect.
- **CI is structured, not monolithic.** Three named jobs, 25 individually
  named steps, plus an ACL-drift gate (`:282`) and a real-sshd fixture job
  (`:335`) that exists specifically because the unit suite cannot detect PTY
  hangs.

## Usability

- **The fingerprint trust prompt**
  (`apps/desktop/src/components/common/FingerprintTrustPrompt.tsx:38-104`) is
  excellent: it explains what trust means, shows all candidate algorithms,
  distinguishes Reject from Trust, and warns about future rejection.
- **The Keys page error handling** (`apps/desktop/src/routes/KeysPage.tsx:55-57,160-176`)
  uses separate `editorError` / `scanError` / `copyError` channels, each
  routed through `formatBackendFailure`, with per-action busy states.
- **Trust-policy form validation**
  (`apps/desktop/src/routes/SettingsTrustPolicySection.tsx:87-103`) is inline,
  specific and actionable — *"Rotation cannot start before the key becomes
  valid."*
- **The identity delete confirmation**
  (`apps/desktop/src/routes/SettingsPage.tsx:402-406`) is a model destructive
  dialog: it names the entity, states the consequence (*"will keep working
  from their per-host credential fields"*), and says how to re-bind later.
- **The keyboard cheatsheet** (`apps/desktop/src/components/common/KeyboardCheatsheet.tsx`)
  is complete, discoverable via `?`, and correctly derived from
  `navigationItems` so it cannot drift.
- **Global focus visibility** (`apps/desktop/src/styles/globals.css:185-187`)
  is a single `:focus-visible` outline rule covering all interactive
  elements, with `outline-offset`.
- **Icon-only button labelling.** `HostCard.tsx:43`, `HostList.tsx:97,111,184`
  all carry meaningful `aria-label`s (e.g. `Delete ${host.label}`).
- **The empty-inventory welcome panel**
  (`apps/desktop/src/components/hosts/WelcomePanel.tsx:54-113`) is calm — one
  primary action plus three sensible secondary paths — with a proper
  `role="region"` and label. The *content* is sound; only its failure
  handling is not.
- **Modal viewport clamping** (`apps/desktop/src/components/common/Modal.tsx:78-92`)
  uses `max-h-[calc(100vh-5rem)]` with a scrolling body — a real fix for
  short screens.
- **The FileBrowser cancellation escape hatch**
  (`apps/desktop/src/components/sftp/FileBrowser.tsx:551-557`) offers an
  explicit "Cancel" for a load against an unresponsive server, with the
  rationale documented in-code.
- **In-pane scrollback search**
  (`apps/desktop/src/components/terminal/use-terminal-pane-search.ts`) works
  over xterm's own buffer.
- **Host-key mismatch is excluded from auto-retry**
  (`apps/desktop/src/components/terminal/connect-failure-policy.ts:13-21`) —
  correct, well-reasoned policy.
- **The disconnect notification**
  (`apps/desktop/src/hooks/useDisconnectNotifications.ts:47-67`) fires on
  genuine transitions only and suppresses itself when the user is already
  watching the affected pane.

## E2E coverage gaps

These journeys are not covered, which is why the silent-failure class of
defect has survived:

- **No runbook e2e spec exists at all** — `grep -rln "runbook" tests/e2e/`
  returns nothing across the 23 spec files. The entire runbook journey
  (edit → run → step → reset → delete) is untested end to end. Matches UX-10.
- **No e2e for any failure path**: no connect-failure spec (auth failure,
  unreachable host, rejected fingerprint), no snippet-broadcast failure, no
  SFTP error-message spec, no session-restore-failure spec. Matches UX-1,
  UX-6, UX-7, UX-8.
- **No terminal reconnect / disconnect-mid-command spec** — only
  `tests/e2e/sidebar.spec.ts` mentions "disconnect" at all. Matches UX-20.
- The existing specs (`hosts.spec.ts`, `snippets.spec.ts`, `sftp.spec.ts`,
  `sessions.spec.ts`, `onboarding.spec.ts`) cover happy paths and render
  assertions.

---

# Appendix — Verification record

Every finding above was produced by three parallel read-only reviews (security,
maintainability, usability) over the same commit. The headline claims were then
re-verified independently, by reading the cited code directly and — in two
cases — by **executing** the relevant logic rather than inferring it.

## Proven by execution

**MAINT-1 — the glob matcher drift.** Both implementations were extracted and
run against the same inputs. Rust matches an astral character and a newline
where Node matches neither. Reproducible, not inferred.

**MAINT-2 — the `.env` precedence inversion.** The real `scripts/load-env.sh`
was sourced and its own loader re-invoked against a simulated `.env`.
`TERMSNIP_UI_PORT=3999` and `MACOS_RELEASE_CHANNEL=nightly` both stayed at
their `.env.shared` values.

## Verified by reading the code directly

UX-1 (all seven call sites), UX-2, UX-3, UX-23, UX-25, SEC-1 (all four links
in the chain, plus the greps for `Access-Control` / `OPTIONS` across
`apps/desktop/server/`, which return no matches), SEC-2, SEC-4, MAINT-2 (the
docs side), MAINT-3, MAINT-4 (similarity recomputed: 0.882 normalised / 0.893
raw, 51 changed lines), MAINT-5 (repository-wide search for `stderrSemantics`
returns zero hits outside the fixture), MAINT-8 (the production/test split and
the `expect()` counts), MAINT-11, MAINT-13, SEC-8 (partial), and the CI
script-injection clearance (all `${{ github.* }}` values reach scripts via
`env:`; `BASE_REF` is consumed quoted; `RELEASE_TAG_INPUT` is only `echo`ed).

Seven findings that had not been individually re-read were spot-checked by
printing the cited ranges afterwards — all seven landed exactly where the
finding claims.

## One correction

A review initially reported "181 `expect()` and 4 `unwrap()` in `main.rs`" as
a production-code signal. Recounting at the `#[cfg(test)]` boundaries gives
**2 `expect()` and 0 `unwrap()`** for production code; the 181 counts inline
test assertions. The substantive conclusion — that production Rust error
handling is clean — holds, but the raw number must not be used as a
production metric. See MAINT-8.

## Not independently re-verified

Roughly 30 findings are single-sourced from the reviewers and are marked
**Confirmed by the reviewer** rather than by the verification pass. They are
well-evidenced but should be confirmed before being acted on: SEC-5 through
SEC-10 (except the SEC-8 partial), MAINT-6, MAINT-7, MAINT-9, MAINT-12,
MAINT-14, MAINT-15, and UX-5 through UX-22 and UX-24.

## What was not done

The e2e/Playwright suite was not run. No live SSH host, `~/.ssh`, or Keychain
access was used. No finding here rests on runtime observation of the
application — every one is a source-level claim, and the two marked "proven by
execution" are proved by running the relevant logic in isolation.
