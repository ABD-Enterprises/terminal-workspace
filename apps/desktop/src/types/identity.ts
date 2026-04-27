// Reusable connection identity. The single most-impactful structural change
// in the parity-and-hardening plan — without it, "I share one key across 50
// hosts" requires 50 host edits and 50 separate passphrase prompts.
//
// An Identity bundles the credential-shaped fields that travel together:
// (username, authMethod, privateKeyPath, keyId, hasPassphrase). A host then
// references an Identity by id, leaving hostname / port / protocol / group /
// tags / environment on the host itself. Two hosts using the same key share
// one identity → one place to update the key, one passphrase prompt.
//
// This is delivered in batches:
//   Batch 1 (this file):
//     - Schema + helpers + sample data.
//     - identityId added to HostRecord as an OPTIONAL field. The runtime
//       still reads username / privateKeyPath / authMethod off the host
//       record itself, so this batch is purely additive: nothing breaks
//       if the migration partially fails.
//   Batch 2: UI for managing identities + HostEditor identity picker.
//   Batch 3: connections.ts and runtime-secrets switch to read from the
//            identity, deprecating the per-host credential fields.
//   Batch 4: remove the deprecated host fields.
//
// See docs/parity-and-hardening-plan.md P2-DM1 and review §2.1.

import type { HostAuthMethod } from "./host";

export type IdentitySource =
  | "imported" // user explicitly created or imported
  | "derived"; // auto-derived from a host record by P2-DM1 migration

export interface IdentityRecord {
  id: string;
  /**
   * Human-friendly label, e.g. "Deploy Key (deploy@billing-api)".
   * Derived migration sets this from the source host's label + username +
   * key path; users can rename freely after.
   */
  label: string;
  username: string;
  authMethod: HostAuthMethod;
  /** Empty string when authMethod !== "privateKey". */
  privateKeyPath: string;
  /**
   * Optional FK to KeyRecord. The keys store may not contain the key yet
   * (a host can reference a key file that hasn't been imported). Null is
   * always safe — callers can fall back to `privateKeyPath` lookup.
   */
  keyId?: string;
  /**
   * Whether the underlying private key requires a passphrase. Used by the
   * UI to decide whether to surface a passphrase prompt. May lag the key
   * record's `hasPassphrase` after edits — refreshed on next inspection.
   */
  hasPassphrase: boolean;
  /** Free-form note. Unused by the runtime, surfaced in the picker. */
  comment: string;
  /** Provenance — `derived` identities can be safely re-derived; `imported`
   *  ones must be preserved across re-runs of the migration. */
  source: IdentitySource;
  createdAt: string;
  updatedAt: string;
}

/**
 * Compute the equivalence key used by the migration to dedupe hosts into
 * identities. Two host configurations with the same equivalence key map to
 * the same identity. The key MUST stay stable across migration runs to keep
 * the operation idempotent.
 *
 * Rules:
 *   - authMethod is part of the key (a password identity is never the same
 *     as a privateKey identity even if username / path match).
 *   - For privateKey, the path is part of the key (rotating to a new key
 *     should produce a new identity).
 *   - For password, the path is ignored (no key file involved).
 *   - For "none", we do not produce identities at all (local shells, telnet,
 *     etc. don't need credential bundling).
 *   - username is always part of the key — same key under two different
 *     accounts is two identities.
 */
export function buildIdentityEquivalenceKey(parts: {
  authMethod: HostAuthMethod;
  username: string;
  privateKeyPath: string;
}): string | null {
  const username = parts.username.trim();
  if (parts.authMethod === "none") {
    return null;
  }
  if (parts.authMethod === "privateKey") {
    const path = parts.privateKeyPath.trim();
    if (!path) {
      return null;
    }
    return `privateKey|${username}|${path}`;
  }
  if (parts.authMethod === "password") {
    return `password|${username}`;
  }
  return null;
}

/**
 * Render a default label for a freshly derived identity. Users can edit it
 * after the fact.
 */
export function deriveIdentityLabel(parts: {
  authMethod: HostAuthMethod;
  username: string;
  privateKeyPath: string;
  keyLabel?: string;
  hostLabel?: string;
}): string {
  const username = parts.username.trim() || "user";
  if (parts.authMethod === "privateKey") {
    if (parts.keyLabel?.trim()) {
      return `${parts.keyLabel.trim()} (${username})`;
    }
    const path = parts.privateKeyPath.trim();
    const filename = path.split("/").pop() || path || "key";
    return `${filename} (${username})`;
  }
  if (parts.authMethod === "password") {
    return parts.hostLabel?.trim()
      ? `${username}@${parts.hostLabel.trim()} (password)`
      : `${username} (password)`;
  }
  return username;
}

/** Two seeded identities matching the seeded sample hosts. */
export const sampleIdentities: IdentityRecord[] = [
  {
    id: "identity-prod-bastion-ops",
    label: "MacBook Pro ED25519 (ops)",
    username: "ops",
    authMethod: "privateKey",
    privateKeyPath: "~/.ssh/id_ed25519",
    keyId: "key-prod-ed25519",
    hasPassphrase: true,
    comment: "Default identity for the production gateway host.",
    source: "imported",
    createdAt: "2026-03-20T12:00:00.000Z",
    updatedAt: "2026-03-29T11:10:00.000Z",
  },
  {
    id: "identity-deploy",
    label: "Deploy Shared Key (deploy)",
    username: "deploy",
    authMethod: "privateKey",
    privateKeyPath: "~/.ssh/deploy_key",
    keyId: "key-deploy-shared",
    hasPassphrase: false,
    comment: "Shared by every blue/green deploy target.",
    source: "imported",
    createdAt: "2026-03-18T08:30:00.000Z",
    updatedAt: "2026-03-28T20:12:00.000Z",
  },
];
