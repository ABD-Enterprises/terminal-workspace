// Pure migration: derive Identity records from existing host records.
//
// Called by `useIdentitiesStore` on first hydrate (and re-runnable safely
// any time after that — idempotent). Produces:
//   - new identities to insert (deduped by equivalence key)
//   - per-host {hostId → identityId} assignments
//   - any existing identities that are no longer referenced by any host
//     (returned for diagnostic logging; we do NOT auto-delete imported
//     identities since the user may have created them on purpose)
//
// Non-destructive: hosts keep their existing username / privateKeyPath /
// authMethod fields. Batch 3 of P2-DM1 will switch the runtime to read
// from the resolved identity instead of the per-host fields.
//
// See docs/parity-and-hardening-plan.md P2-DM1.

import { sampleHosts, type HostRecord } from "../types/host";
import {
  buildIdentityEquivalenceKey,
  deriveIdentityLabel,
  type IdentityRecord,
} from "../types/identity";
import type { KeyRecord } from "../types/key";

export interface IdentityMigrationInput {
  hosts: HostRecord[];
  keys: KeyRecord[];
  existingIdentities: IdentityRecord[];
  /**
   * Inject a stable id-generator for tests. Production callers leave it
   * undefined to use crypto.randomUUID(). Each invocation must return a
   * fresh unique id.
   */
  generateId?: () => string;
  /**
   * Inject "now" for tests. Production callers leave it undefined.
   */
  now?: () => string;
}

export interface IdentityMigrationResult {
  /** Identities that should be added to the store (existing identities are
   *  reused via `assignmentsByHostId`, not duplicated here). */
  identitiesToAdd: IdentityRecord[];
  /** Map of hostId → resolved identityId. Hosts with `authMethod === "none"`
   *  or otherwise unkeyable inputs are absent from this map. */
  assignmentsByHostId: Record<string, string>;
  /** Existing identities that no host now references. Returned for logging
   *  only — auto-deletion is unsafe because the user may have hand-created
   *  identities they intend to use later. */
  orphanedIdentityIds: string[];
}

function normaliseExistingIdentity(identity: IdentityRecord): {
  identity: IdentityRecord;
  equivalenceKey: string | null;
} {
  return {
    identity,
    equivalenceKey: buildIdentityEquivalenceKey({
      authMethod: identity.authMethod,
      username: identity.username,
      privateKeyPath: identity.privateKeyPath,
    }),
  };
}

function pickKeyIdForPath(privateKeyPath: string, keys: KeyRecord[]): string | undefined {
  const trimmed = privateKeyPath.trim();
  if (!trimmed) {
    return undefined;
  }
  return keys.find((entry) => entry.privateKeyPath.trim() === trimmed)?.id;
}

function pickHasPassphraseForPath(privateKeyPath: string, keys: KeyRecord[]): boolean {
  const trimmed = privateKeyPath.trim();
  if (!trimmed) {
    return false;
  }
  return Boolean(keys.find((entry) => entry.privateKeyPath.trim() === trimmed)?.hasPassphrase);
}

/**
 * Run the migration. Pure — does NOT touch any zustand store. The caller
 * applies the result by calling identities-store actions and patching the
 * hosts collection with the assignment map.
 */
export function migrateHostsToIdentities(input: IdentityMigrationInput): IdentityMigrationResult {
  const generateId = input.generateId ?? (() => crypto.randomUUID());
  const now = input.now ?? (() => new Date().toISOString());

  // Build a lookup over existing identities by equivalence key. When two
  // existing identities share a key (the user manually created duplicates)
  // we prefer the earliest by `createdAt` so the result is deterministic.
  const existingByKey = new Map<string, IdentityRecord>();
  for (const identity of [...input.existingIdentities].sort((left, right) =>
    left.createdAt.localeCompare(right.createdAt)
  )) {
    const { equivalenceKey } = normaliseExistingIdentity(identity);
    if (equivalenceKey && !existingByKey.has(equivalenceKey)) {
      existingByKey.set(equivalenceKey, identity);
    }
  }

  const assignmentsByHostId: Record<string, string> = {};
  const newIdentitiesByKey = new Map<string, IdentityRecord>();
  const referencedIdentityIds = new Set<string>();

  for (const host of input.hosts) {
    // Respect a pre-existing identityId on the host (a previous migration
    // run, or a user-set value). We still record the reference so it
    // doesn't show up in the orphan list.
    if (host.identityId) {
      referencedIdentityIds.add(host.identityId);
      const previously = input.existingIdentities.find((entry) => entry.id === host.identityId);
      if (previously) {
        // Already linked to a real identity — leave it alone.
        assignmentsByHostId[host.id] = previously.id;
        continue;
      }
      // identityId points at a missing record — fall through and re-resolve
      // so the link is healed.
    }

    const equivalenceKey = buildIdentityEquivalenceKey({
      authMethod: host.authMethod,
      username: host.username,
      privateKeyPath: host.privateKeyPath,
    });
    if (!equivalenceKey) {
      // Local shells, telnet, unauthenticated hosts — no identity needed.
      continue;
    }

    const existing = existingByKey.get(equivalenceKey) ?? newIdentitiesByKey.get(equivalenceKey);
    if (existing) {
      assignmentsByHostId[host.id] = existing.id;
      referencedIdentityIds.add(existing.id);
      continue;
    }

    const identity: IdentityRecord = {
      id: generateId(),
      label: deriveIdentityLabel({
        authMethod: host.authMethod,
        username: host.username,
        privateKeyPath: host.privateKeyPath,
        keyLabel: host.keyLabel,
        hostLabel: host.label,
      }),
      username: host.username,
      authMethod: host.authMethod,
      privateKeyPath: host.authMethod === "privateKey" ? host.privateKeyPath : "",
      keyId:
        host.authMethod === "privateKey"
          ? pickKeyIdForPath(host.privateKeyPath, input.keys)
          : undefined,
      hasPassphrase:
        host.authMethod === "privateKey"
          ? pickHasPassphraseForPath(host.privateKeyPath, input.keys)
          : false,
      comment: "",
      source: "derived",
      createdAt: now(),
      updatedAt: now(),
    };
    newIdentitiesByKey.set(equivalenceKey, identity);
    assignmentsByHostId[host.id] = identity.id;
    referencedIdentityIds.add(identity.id);
  }

  const orphanedIdentityIds = input.existingIdentities
    .filter((identity) => !referencedIdentityIds.has(identity.id))
    .map((identity) => identity.id);

  return {
    identitiesToAdd: Array.from(newIdentitiesByKey.values()),
    assignmentsByHostId,
    orphanedIdentityIds,
  };
}

/**
 * Apply the migration result to a hosts collection by stamping `identityId`
 * onto each host. Returns a new array — does not mutate the input.
 */
export function applyIdentityAssignments(
  hosts: HostRecord[],
  assignmentsByHostId: Record<string, string>
): HostRecord[] {
  let mutated = false;
  const next = hosts.map((host) => {
    const nextIdentityId = assignmentsByHostId[host.id];
    if (!nextIdentityId || host.identityId === nextIdentityId) {
      return host;
    }
    mutated = true;
    return { ...host, identityId: nextIdentityId };
  });
  return mutated ? next : hosts;
}

// Re-exported for tests so the sample-hosts default migration path can be
// asserted without reaching into the Zustand store.
export const __sampleMigrationInput: Pick<IdentityMigrationInput, "hosts"> = {
  hosts: sampleHosts,
};
