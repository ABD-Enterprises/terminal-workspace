// Persisted catalogue of reusable connection identities. See
// internal/parity-and-hardening-plan.md P2-DM1 (batch 1). The store is purely
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
import {
  sampleIdentities,
  type IdentityRecord,
  type IdentitySource,
} from "../types/identity";
import { clearIdentityPassphraseById } from "./connection-secrets-store";
import { useHostsStore } from "./hosts-store";
import { useKeysStore } from "./keys-store";
import { useVaultSyncStore } from "./vault-sync-store";

function sortIdentities(identities: IdentityRecord[]): IdentityRecord[] {
  return [...identities].sort((left, right) => left.label.localeCompare(right.label));
}

interface IdentitiesState {
  identities: IdentityRecord[];
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
   * Run the host→identity migration once per session. Idempotent: re-running
   * with a fully migrated set is a no-op. Safe to call from anywhere.
   */
  ensureMigrated: () => void;
}

interface PersistedIdentitiesState {
  identities: IdentityRecord[];
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

export const useIdentitiesStore = create<IdentitiesState>()(
  persist(
    (set, get) => ({
      identities: sortIdentities(sampleIdentities),
      migrationCompleted: false,
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
      removeIdentity: (identityId) => {
        const target = get().identities.find((entry) => entry.id === identityId);
        if (!target) {
          return undefined;
        }
        set((state) => ({
          identities: state.identities.filter((entry) => entry.id !== identityId),
        }));
        useVaultSyncStore.getState().markDeleted("identities", identityId);
        // GC the per-identity Keychain passphrase entry. Fire-and-forget —
        // failures are logged inside clearIdentityPassphraseById and must
        // not block the synchronous delete return value. See
        // parity-and-hardening-plan.md P2-DM1 batch 3.
        void clearIdentityPassphraseById(identityId);
        return target;
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
      }),
      merge: (persistedState, currentState) => {
        const persistedIdentities =
          (persistedState as Partial<PersistedIdentitiesState> | undefined)?.identities ??
          currentState.identities;
        return {
          ...currentState,
          identities: sortIdentities(persistedIdentities),
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
