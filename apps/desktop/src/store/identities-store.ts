// Persisted catalogue of reusable connection identities. See
// docs/parity-and-hardening-plan.md P2-DM1 (batch 1). The store is purely
// additive in this batch: nothing in the runtime reads an Identity yet,
// but the records exist (and are kept in sync via auto-migration) so
// batch 3 can flip the read path without a separate migration step.

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import {
  applyIdentityAssignments,
  migrateHostsToIdentities,
} from "../lib/identity-migration";
import { createTermsnipStorage } from "../lib/persistence";
import { cancelUndoWindow, expireUndoWindowNow, restoredUpdatedAt, startUndoWindow } from "../lib/undo-delete";
import {
  sampleIdentities,
  type IdentityRecord,
  type IdentitySource,
} from "../types/identity";
import { clearIdentityPassphraseById } from "./connection-secrets-store";
import { useHostsStore } from "./hosts-store";
import { useKeysStore } from "./keys-store";
import { useVaultSyncStore } from "./vault-sync-store";

// UX-13: undoable delete — see keys-store for the full contract. The
// Keychain passphrase GC defers to window expiry; the vault tombstone is
// written now and cleared on undo. The stash is session-only (partialize
// below already excludes it).
const UNDO_WINDOW_KEY = "identities:delete";
const UNDO_WINDOW_MS = 5_000;

function sortIdentities(identities: IdentityRecord[]): IdentityRecord[] {
  return [...identities].sort((left, right) => left.label.localeCompare(right.label));
}

interface IdentitiesState {
  identities: IdentityRecord[];
  /** Record removed by the most recent delete, pending expiry or undo. */
  pendingDeletedIdentity?: IdentityRecord;
  /**
   * Identity ids whose Keychain passphrase still has to be cleared. Persisted
   * (unlike the undo stash) so quitting inside the undo window cannot leave a
   * deleted identity's passphrase behind; cleared at the next start.
   */
  pendingPassphraseCleanupIds: string[];
  /** True once the host→identity auto-migration has run for this session. */
  migrationCompleted: boolean;
  upsertIdentity: (
    identity: Omit<IdentityRecord, "createdAt" | "updatedAt"> & {
      createdAt?: string;
      updatedAt?: string;
    }
  ) => string;
  setLabel: (identityId: string, label: string) => void;
  setComment: (identityId: string, comment: string) => void;
  removeIdentity: (identityId: string) => IdentityRecord | undefined;
  /**
   * Restore the pending deleted identity, but only if it is the one named by
   * `identityId`, so an Undo bound to an older deletion cannot restore a newer one.
   */
  restoreDeletedIdentity: (identityId: string) => IdentityRecord | undefined;
  /** Clear the Keychain passphrase of every id left in `pendingPassphraseCleanupIds`. Runs at startup. */
  reconcilePendingCleanups: () => void;
  /**
   * End the undo window now without restoring: the deletion becomes final and
   * its passphrase cleanup runs unless the identity exists again. Used when
   * the inventory is replaced (config import) while a delete is pending.
   */
  expirePendingDeletion: () => void;
  /**
   * Run the host→identity migration once per session. Idempotent: re-running
   * with a fully migrated set is a no-op. Safe to call from anywhere.
   */
  ensureMigrated: () => void;
}

interface PersistedIdentitiesState {
  identities: IdentityRecord[];
  pendingPassphraseCleanupIds: string[];
}

function logIdentityError(action: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  console.warn(`identities-store ${action} failed: ${message}`);
}

function makeIdentityRecord(
  partial: Omit<IdentityRecord, "createdAt" | "updatedAt"> & {
    createdAt?: string;
    updatedAt?: string;
  }
): IdentityRecord {
  const now = new Date().toISOString();
  const source: IdentitySource = partial.source ?? "imported";
  return {
    id: partial.id,
    label: partial.label,
    username: partial.username,
    authMethod: partial.authMethod,
    privateKeyPath: partial.privateKeyPath,
    keyId: partial.keyId,
    hasPassphrase: partial.hasPassphrase,
    comment: partial.comment ?? "",
    source,
    createdAt: partial.createdAt ?? now,
    updatedAt: partial.updatedAt ?? now,
  };
}

// Finalise a deletion: forget the pending cleanup, drop the stash if it still
// belongs to this identity, and clear the Keychain passphrase unless the
// identity exists again.
function finalizeIdentityDeletion(
  deleted: IdentityRecord,
  get: () => IdentitiesState,
  set: (update: (state: IdentitiesState) => Partial<IdentitiesState>) => void
) {
  const stillUsed = get().identities.some((entry) => entry.id === deleted.id);
  set((state) => ({
    pendingDeletedIdentity:
      state.pendingDeletedIdentity?.id === deleted.id ? undefined : state.pendingDeletedIdentity,
    pendingPassphraseCleanupIds: state.pendingPassphraseCleanupIds.filter(
      (entry) => entry !== deleted.id
    ),
  }));
  if (!stillUsed) {
    void clearIdentityPassphraseById(deleted.id);
  }
}

export const useIdentitiesStore = create<IdentitiesState>()(
  persist(
    (set, get) => ({
      identities: sortIdentities(sampleIdentities),
      migrationCompleted: false,
      pendingPassphraseCleanupIds: [],
      upsertIdentity: (input) => {
        const record = makeIdentityRecord(input);
        set((state) => ({
          identities: sortIdentities([
            ...state.identities.filter((entry) => entry.id !== record.id),
            record,
          ]),
        }));
        useVaultSyncStore.getState().clearDeleted("identities", record.id);
        return record.id;
      },
      setLabel: (identityId, label) =>
        set((state) => ({
          identities: sortIdentities(
            state.identities.map((entry) =>
              entry.id === identityId
                ? { ...entry, label, updatedAt: new Date().toISOString() }
                : entry
            )
          ),
        })),
      setComment: (identityId, comment) =>
        set((state) => ({
          identities: sortIdentities(
            state.identities.map((entry) =>
              entry.id === identityId
                ? { ...entry, comment, updatedAt: new Date().toISOString() }
                : entry
            )
          ),
        })),
      // UX-13: soft delete with an undo window; the Keychain passphrase GC
      // defers to window expiry so Undo keeps the passphrase usable.
      removeIdentity: (identityId) => {
        const target = get().identities.find((entry) => entry.id === identityId);
        if (!target) {
          return undefined;
        }

        const finalize = (deleted: IdentityRecord) => finalizeIdentityDeletion(deleted, get, set);

        const stale = get().pendingDeletedIdentity;
        expireUndoWindowNow(UNDO_WINDOW_KEY, () => {
          if (stale) {
            finalize(stale);
          }
        });
        // The removal and the durable cleanup record are one state change, so
        // they are persisted together.
        set((state) => ({
          pendingDeletedIdentity: target,
          pendingPassphraseCleanupIds: Array.from(
            new Set([...state.pendingPassphraseCleanupIds, target.id])
          ),
          identities: state.identities.filter((entry) => entry.id !== identityId),
        }));
        useVaultSyncStore.getState().markDeleted("identities", identityId);
        startUndoWindow(UNDO_WINDOW_KEY, UNDO_WINDOW_MS, () => finalize(target));
        return target;
      },
      restoreDeletedIdentity: (identityId) => {
        const stash = get().pendingDeletedIdentity;
        if (!stash || stash.id !== identityId) {
          return undefined;
        }
        if (get().identities.some((entry) => entry.id === stash.id)) {
          // The inventory already has this id (e.g. an import brought it
          // back): restoring would duplicate it.
          get().expirePendingDeletion();
          return undefined;
        }
        cancelUndoWindow(UNDO_WINDOW_KEY);
        const restored = {
          ...stash,
          updatedAt: restoredUpdatedAt("identities", stash.id, stash.updatedAt),
        };
        useVaultSyncStore.getState().clearDeleted("identities", stash.id);
        set((state) => ({
          pendingDeletedIdentity: undefined,
          pendingPassphraseCleanupIds: state.pendingPassphraseCleanupIds.filter(
            (entry) => entry !== stash.id
          ),
          identities: sortIdentities([...state.identities, restored]),
        }));
        return restored;
      },
      expirePendingDeletion: () => {
        const stash = get().pendingDeletedIdentity;
        if (!stash) {
          return;
        }
        cancelUndoWindow(UNDO_WINDOW_KEY);
        finalizeIdentityDeletion(stash, get, set);
      },
      reconcilePendingCleanups: () => {
        // A live undo window owns its own id; leave that one alone.
        const live = get().pendingDeletedIdentity?.id;
        const due = get().pendingPassphraseCleanupIds.filter((entry) => entry !== live);
        if (due.length === 0) {
          return;
        }
        const inUse = new Set(get().identities.map((entry) => entry.id));
        set((state) => ({
          pendingPassphraseCleanupIds: state.pendingPassphraseCleanupIds.filter(
            (entry) => !due.includes(entry)
          ),
        }));
        for (const identityId of due) {
          if (!inUse.has(identityId)) {
            void clearIdentityPassphraseById(identityId);
          }
        }
      },
      ensureMigrated: () => {
        if (get().migrationCompleted) {
          return;
        }
        try {
          const hostsState = useHostsStore.getState();
          const keysState = useKeysStore.getState();
          const result = migrateHostsToIdentities({
            hosts: hostsState.hosts,
            keys: keysState.keys,
            existingIdentities: get().identities,
          });

          if (result.identitiesToAdd.length > 0) {
            set((state) => ({
              identities: sortIdentities([...state.identities, ...result.identitiesToAdd]),
            }));
          }

          if (Object.keys(result.assignmentsByHostId).length > 0) {
            const nextHosts = applyIdentityAssignments(
              hostsState.hosts,
              result.assignmentsByHostId
            );
            if (nextHosts !== hostsState.hosts) {
              useHostsStore.setState({ hosts: nextHosts });
            }
          }

          set({ migrationCompleted: true });

          if (
            result.identitiesToAdd.length > 0 ||
            Object.keys(result.assignmentsByHostId).length > 0
          ) {
            console.info(
              `[identities] migration: derived ${result.identitiesToAdd.length} identities, linked ${Object.keys(result.assignmentsByHostId).length} hosts, ${result.orphanedIdentityIds.length} orphans.`
            );
          }
        } catch (error) {
          logIdentityError("ensureMigrated", error);
          // Mark complete to avoid infinite retry; the next session will
          // try again after a code change.
          set({ migrationCompleted: true });
        }
      },
    }),
    {
      name: "terminal-workspace-identities",
      version: 1,
      storage: createJSONStorage(() => createTermsnipStorage("terminal-workspace-identities")),
      partialize: (state): PersistedIdentitiesState => ({
        identities: state.identities,
        pendingPassphraseCleanupIds: state.pendingPassphraseCleanupIds,
      }),
      onRehydrateStorage: () => () => {
        // Run after the store is assigned (hydration may finish synchronously).
        setTimeout(() => useIdentitiesStore.getState().reconcilePendingCleanups(), 0);
      },
      merge: (persistedState, currentState) => {
        const persistedIdentities =
          (persistedState as Partial<PersistedIdentitiesState> | undefined)?.identities ??
          currentState.identities;
        const persistedCleanups = (
          persistedState as Partial<PersistedIdentitiesState> | undefined
        )?.pendingPassphraseCleanupIds;
        return {
          ...currentState,
          identities: sortIdentities(persistedIdentities),
          pendingPassphraseCleanupIds: Array.isArray(persistedCleanups) ? persistedCleanups : [],
          // Re-run migration each session start so newly-added hosts pick
          // up identities without requiring an explicit user action.
          migrationCompleted: false,
        };
      },
    }
  )
);

/**
 * Fire the identity migration eagerly. Imported by the app entry so it runs
 * once per session right after stores hydrate. Safe to call repeatedly —
 * `ensureMigrated` short-circuits when already done.
 */
export function ensureIdentitiesMigrated(): void {
  useIdentitiesStore.getState().ensureMigrated();
}
