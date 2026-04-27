import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";

export type VaultSyncEntityKind =
  | "hosts"
  | "keys"
  | "snippets"
  | "knownHosts"
  | "identities";

export interface VaultDeletionEntry {
  id: string;
  deletedAt: string;
}

export interface VaultDeletionMap {
  hosts: VaultDeletionEntry[];
  keys: VaultDeletionEntry[];
  snippets: VaultDeletionEntry[];
  knownHosts: VaultDeletionEntry[];
  /**
   * Tombstones for reusable Identity records (P2-DM1). Older persisted
   * snapshots may omit this field; callers must default to [] on load.
   */
  identities: VaultDeletionEntry[];
}

export const VAULT_TOMBSTONE_RETENTION_DAYS = 90;
export const VAULT_TOMBSTONE_MAX_ENTRIES_PER_KIND = 256;
const VAULT_TOMBSTONE_RETENTION_MS = VAULT_TOMBSTONE_RETENTION_DAYS * 24 * 60 * 60 * 1000;

const fallbackStorage: StateStorage = {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
};

function sortDeletionEntries(entries: VaultDeletionEntry[]) {
  return [...entries].sort((left, right) => right.deletedAt.localeCompare(left.deletedAt));
}

export function compactDeletionEntries(
  entries: VaultDeletionEntry[],
  now = Date.now()
): VaultDeletionEntry[] {
  const cutoff = now - VAULT_TOMBSTONE_RETENTION_MS;
  const latestById = new Map<string, VaultDeletionEntry>();

  for (const entry of entries) {
    if (!entry.id || !entry.deletedAt) {
      continue;
    }

    const deletedAtMs = Date.parse(entry.deletedAt);
    if (Number.isNaN(deletedAtMs) || deletedAtMs < cutoff) {
      continue;
    }

    const existing = latestById.get(entry.id);
    if (!existing || entry.deletedAt > existing.deletedAt) {
      latestById.set(entry.id, {
        id: entry.id,
        deletedAt: entry.deletedAt,
      });
    }
  }

  return sortDeletionEntries([...latestById.values()]).slice(0, VAULT_TOMBSTONE_MAX_ENTRIES_PER_KIND);
}

export function compactDeletionMap(deletions: Partial<VaultDeletionMap> | null | undefined, now = Date.now()): VaultDeletionMap {
  return {
    hosts: compactDeletionEntries(deletions?.hosts ?? [], now),
    keys: compactDeletionEntries(deletions?.keys ?? [], now),
    snippets: compactDeletionEntries(deletions?.snippets ?? [], now),
    knownHosts: compactDeletionEntries(deletions?.knownHosts ?? [], now),
    identities: compactDeletionEntries(deletions?.identities ?? [], now),
  };
}

function upsertDeletionEntry(entries: VaultDeletionEntry[], id: string, deletedAt: string) {
  return sortDeletionEntries([
    { id, deletedAt },
    ...entries.filter((entry) => entry.id !== id),
  ]);
}

function removeDeletionEntry(entries: VaultDeletionEntry[], id: string) {
  return sortDeletionEntries(entries.filter((entry) => entry.id !== id));
}

function emptyDeletionMap(): VaultDeletionMap {
  return {
    hosts: [],
    keys: [],
    snippets: [],
    knownHosts: [],
    identities: [],
  };
}

interface VaultSyncState {
  deletions: VaultDeletionMap;
  markDeleted: (kind: VaultSyncEntityKind, id: string, deletedAt?: string) => void;
  clearDeleted: (kind: VaultSyncEntityKind, id: string) => void;
  replaceDeletions: (deletions: VaultDeletionMap) => void;
}

export const useVaultSyncStore = create<VaultSyncState>()(
  persist(
    (set) => ({
      deletions: emptyDeletionMap(),
      markDeleted: (kind, id, deletedAt = new Date().toISOString()) =>
        set((state) => ({
          deletions: {
            ...state.deletions,
            [kind]: compactDeletionEntries(upsertDeletionEntry(state.deletions[kind], id, deletedAt)),
          },
        })),
      clearDeleted: (kind, id) =>
        set((state) => ({
          deletions: {
            ...state.deletions,
            [kind]: removeDeletionEntry(state.deletions[kind], id),
          },
        })),
      replaceDeletions: (deletions) =>
        set({
          deletions: compactDeletionMap(deletions),
        }),
    }),
    {
      name: "termsnip-vault-sync",
      version: 1,
      storage: createJSONStorage(() =>
        typeof window === "undefined" ? fallbackStorage : window.localStorage
      ),
      partialize: (state) => ({
        deletions: compactDeletionMap(state.deletions),
      }),
    }
  )
);
