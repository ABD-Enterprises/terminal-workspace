# End-to-end-encrypted vault cloud sync — design

Status: **Draft for review** (2026-05-06)
Owner: open
Tracking issue: #26

This document takes a position on every open question that issue #26 lists, so an implementation phase can start without re-litigating direction. Where a "we may want X later" alternative exists, it's noted, but the recommended path is the one the implementation tickets will be scoped against.

The whole point of cloud sync for term-snip is to give power users **a competitor-style sync experience without giving up local-first control or trusting a server with cleartext.** Anything that does not serve that goal is out of scope here.

## Existing groundwork

- Local vault snapshots already carry stable identifiers — `vaultId`, `sourceDeviceId`, `snapshotId` — set up in `apps/desktop/src/lib/vault-sync-contract.ts` and exercised by tests in `local-config.test.ts` and `vault-sync-contract.test.ts`. These IDs are the seam where E2E-encrypted sync plugs in.
- Local export/import already round-trips hosts, keys, snippets, and known-host trust to JSON (`apps/desktop/src/lib/local-config.ts`). The same data shape becomes the unit of synchronization.
- macOS Keychain integration (PRs #25 closure context) for host secrets, per-key-fingerprint passphrases, and per-identity passphrases gives us a place to hold the user's vault master key without keeping it in localStorage.

## Open questions and positions

### 1. Encryption

**Position: per-vault symmetric key, wrapped by a user passphrase using Argon2id; per-device public key for join.**

- The vault is encrypted under a single AEAD key (XChaCha20-Poly1305).
- That key never leaves a device in plaintext. It is wrapped with a key derived from the user's passphrase via Argon2id (params: 64 MiB memory, 3 iterations, 4 lanes — well above current OWASP guidance).
- New devices join via a one-time **device-pairing token** generated on an existing device. The token contains the wrapped vault key encrypted with an ephemeral X25519 key agreement against the new device's public key. The pairing token is short-lived (5 minutes) and shown as a QR code or 6-word phrase.
- We do **not** roll our own PAKE in v1. The device-pairing flow is functionally similar (mutually authenticated key exchange), but built from primitives we can audit.

**Why not a per-device key with a CRDT-style ciphertext fan-out:** every record would need to be re-encrypted to N device keys on key rotation, blowing up the protocol. A single vault key is simpler and lets us rotate it as a single ciphertext blob.

**Why Argon2id over scrypt or PBKDF2:** Argon2id is the OWASP and IETF (RFC 9106) current recommendation. WebCrypto doesn't have it natively, so we'll use a vetted library (`@noble/hashes` or equivalent — `argon2-browser` is a maintenance risk). The cost is a one-time sub-second derive on app start, gated behind a launch screen.

**Why XChaCha20-Poly1305 over AES-GCM:** longer nonces (24 bytes vs 12) make accidental nonce reuse much less likely under random generation. We don't need hardware acceleration here — sync payloads are small.

### 2. Backend shape: snapshot-level LWW vs per-record CRDT

**Position: snapshot-level last-writer-wins (LWW) with per-record vector clocks, evolving to record-level merge if real multi-device editing pain shows up.**

The unit of sync is the same JSON snapshot we already export. Each record (host, key, snippet, known-host trust entry) carries a `(vectorClock, lastModifiedAt, lastModifiedBy)` triple. On pull, the client compares its local snapshot against the server's:

- Records with strictly newer vector clocks on one side win automatically.
- Records with concurrent edits (vector clocks neither dominates) raise a conflict that goes through the resolution UI (see §3).
- Atomic toggles (favorite, group rename, last-used time) use a "max wins" rule per field rather than the full conflict UI — these never block a sync.

**Why not a true CRDT (Automerge, Yjs):** a CRDT lets two devices freely edit the same record and converge without explicit conflict UI, but the price is non-trivial: every record carries an op-log, payload size grows over time, and library selection locks us into either Automerge's bytecode or Yjs's binary doc format. For a workspace where you rarely have two devices editing the same host record at the same second, the win is theoretical and the cost is real.

**Migration path if we're wrong:** the snapshot-level LWW protocol is forward-compatible with a per-record op-log because each record is already keyed independently. We can promote individual record types (e.g. "snippet bodies are CRDT-merged, host records remain LWW") without breaking the wire format.

### 3. Conflict resolution UI

**Position: side-by-side diff for the four "noisy" record types (hosts, snippets, keys, known-host entries); silent "max wins" for atomic field toggles.**

When the sync client detects a true concurrent edit (vector clocks neither dominates), the user sees a modal that lists each conflicted record with:
- Local version (left), remote version (right), with field-level diff highlighting.
- "Keep local" / "Keep remote" / "Merge field-by-field" buttons.
- A small "what changed elsewhere" badge so the user understands the second device's edit context.

The four atomic-toggle fields — `favorite`, `lastUsedAt`, `group`, `tagOrder` — never reach this UI. We resolve them server-side with a deterministic rule (max-of-timestamps for `lastUsedAt`, alphabetical-of-deviceIds tiebreaker for `group`).

This UI is the single biggest implementation risk in the whole project. It needs careful attention to keep it from feeling like a Git merge conflict screen — keyboard-friendly, with a "preview the merged record" pane.

### 4. Hosting

**Position: Supabase for alpha + beta, with self-hosting documented from day one. Open question: GA pricing model.**

- **Why Supabase:** Postgres + Storage + Row-Level Security in a single managed service, generous free tier (500 MB DB, 1 GB storage), official client libraries, and predictable pricing past free.
- **Why not a bespoke service:** running a Postgres + S3 + auth stack costs us either a person's time (we don't have it) or a SaaS bill that is larger than Supabase's all-in.
- **Self-hosting:** the server schema is portable Postgres + a small handler service (one Node or Rust process). We document the schema and the four endpoints (push, pull, list-snapshots, delete-snapshot) so an operator can run their own. This is a credibility move for a security-sensitive product, not a v1 feature ship.
- **Pricing (GA, not v1):** free for one device, $4/month for sync across devices. competitor is $10/month; undercutting them by half while keeping E2E encryption is a defensible position. Annual discount likely. **This is a placeholder for the GA conversation, not a commitment.**

### 5. Recovery model

**Position: no server-side recovery (E2E means we *can't* recover); printed recovery key at setup. No social recovery in v1.**

- At first vault setup, the user is shown a one-time recovery key (BIP39 word list, 12 words). The app insists they print it or save it to a password manager before continuing.
- If the user forgets the passphrase and loses the recovery key, their vault is unrecoverable. This is the only honest answer for an E2E-encrypted product. competitor does the same.
- The server will refuse to mass-delete a vault on a "I lost my password" claim. That's the user's recovery key responsibility.

**No social recovery in v1.** Threshold-key sharding ("any 2 of these 3 trusted contacts can recover") is an enterprise feature and adds enough complexity to delay GA. Defer.

### 6. Threat model

**Position: server is honest-but-curious; metadata is minimized but not hidden.**

What the server knows in v1:
- Per-vault: `vaultId`, when it was created, when each device last synced.
- Per-snapshot: `snapshotId`, `byteLength` of ciphertext, `createdAt`, `sourceDeviceId`.
- Per-device: `deviceId`, public key, last seen IP (for rate limiting).
- The user's email (auth).

What the server does **not** know:
- Any record content (hosts, keys, snippets, known-hosts) — all encrypted client-side under the vault key.
- Record counts (we don't break ciphertext into per-record blobs server-side; the whole snapshot is one blob).
- Tags, group names, host aliases, hostnames — all inside the encrypted blob.

Threats the server can plausibly mount:
- **Selective denial-of-service** (refusing one user's sync). Mitigated by self-hosting being documented.
- **Rollback** (serving an older snapshot to one device): mitigated by snapshot vector clocks plus a server-stored monotonic counter; client rejects a snapshot with a counter lower than what it has cached.
- **Traffic analysis** (size of each sync, frequency). Mitigated by padding to 64 KiB buckets, but not eliminated. Documented as a known limitation.

Threats out of scope:
- A compromised client device. If an attacker has your laptop, your vault is compromised regardless of server posture.
- Side-channel attacks on the crypto library. Mitigated by using vetted libraries (`@noble/*`).

### 7. Onboarding and migration

**Position: opt-in, non-destructive both directions. Local-only mode remains the default forever.**

- A user enables sync from Settings. The first sync uploads their existing local vault as the initial snapshot. No local data is deleted.
- A user disables sync from Settings. The vault stays in their local store. The server-side data is wiped after a 30-day grace period (the user can re-enable in that window without re-uploading).
- Migration from another tool (competitor export, etc.) is **not** a sync concern — it goes through the existing JSON import path (`docs/operations.md`), which then becomes the seed for the first cloud sync if enabled.
- Existing local vaults already have a `vaultId`. On first sync enable, that vaultId is used as the cloud-side identifier — no renumbering, no migration UX.

## Phased rollout

### Alpha (internal, ~1 week)

- Single Supabase project shared by the team.
- Sync gated behind a hidden Settings toggle.
- Telemetry: client logs sync events to a local file under `artifacts/` so we can grep when things go sideways. **No remote telemetry in v1.**
- Acceptance: each team member runs sync on two devices for a week with no data loss and no bugs that block daily use.

### Beta (external waitlist, ~2 weeks)

- Settings toggle visible behind an "Experimental" badge.
- Public Supabase project; rate-limited free tier.
- Acceptance: 100 active users, no P0 bugs for a week, one round of UX polish based on beta feedback.

### GA

- Pricing finalized.
- Self-hosting docs published.
- "Recover from forgotten passphrase" support docs explicit about the no-recovery reality.

## Implementation phases

Each phase below is filed as its own ticket against the result of this design doc. Ticket numbers are inserted after this PR merges so the references are durable.

| Phase | Scope | Filed as |
|---|---|---|
| A | Server: Supabase project + tables + Row-Level Security policies for vault, snapshot, device tables. | TBD |
| B | Client crypto primitives: vault key generation, Argon2id passphrase wrap/unwrap, XChaCha20-Poly1305 encrypt/decrypt of snapshot blob, recovery-key BIP39 round-trip. | TBD |
| C | Sync protocol: push (with monotonic counter), pull (with vector-clock diff), list-snapshots, delete-snapshot. Wire format documented in `docs/design/cloud-sync-protocol.md`. | TBD |
| D | Conflict resolution UI: side-by-side diff modal, atomic-toggle resolver, "what changed elsewhere" affordance. | TBD |
| E | Onboarding: setup wizard, recovery-key print/save flow, device-pairing token generation and consumption. | TBD |
| F | Alpha gate: hidden Settings toggle, local telemetry log, internal team dogfood for one week. | TBD |
| G | Beta + GA polish: experimental badge, rate limiting, self-hosting docs, support docs for "lost passphrase" reality. | TBD |

## Open items for the GA conversation (not v1 design)

- Pricing tier specifics (free-quota size, paid features beyond sync).
- iCloud Keychain integration for the master passphrase (would make the recovery key redundant for users who trust iCloud, but binds us to Apple's keychain semantics).
- Linux/Windows secret store equivalents (currently macOS-only via Tauri keychain).
- Threshold/social recovery (5.b).
- "Vault audit log" UI surface (per-snapshot metadata is server-visible already; surfacing it to the user is a v2 polish).

## Decisions captured here that this PR is asking the user to ratify

If you disagree with any of these, comment on the PR before the per-phase tickets are filed:

1. Argon2id + XChaCha20-Poly1305 over AES-GCM-derived stacks.
2. Snapshot-level LWW with vector clocks, **not** a true CRDT.
3. Supabase-hosted alpha and beta. Self-hosting documented but not first-class.
4. No server-side recovery; printed recovery key is the only fallback.
5. Honest-but-curious server threat model; metadata size + sync timing are not hidden.
6. Opt-in, non-destructive sync. Local-only remains the default forever.
