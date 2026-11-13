import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { createTermsnipStorage } from "../lib/persistence";
import { cancelUndoWindow, expireUndoWindowNow, startUndoWindow } from "../lib/undo-delete";
import { sampleKeys, type KeyMetadata, type KeyRecord, type KeySource } from "../types/key";
import { clearKeyPassphraseByFingerprint } from "./connection-secrets-store";
import { useVaultSyncStore } from "./vault-sync-store";

// UX-13: undoable delete — same contract as the snippets store. The Keychain
// passphrase GC and the vault tombstone are what undo protects: the GC is
// deferred to window expiry so an undo within the window keeps the stored
// passphrase usable.
const UNDO_WINDOW_KEY = "keys:delete";
const UNDO_WINDOW_MS = 5_000;

function sortKeys(keys: KeyRecord[]) {
  return [...keys].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function createKeyRecord(
  label: string,
  metadata: KeyMetadata,
  source: KeySource,
  hasPassphrase: boolean
): KeyRecord {
  const now = new Date().toISOString();

  return {
    id: crypto.randomUUID(),
    label: label.trim(),
    algorithm: metadata.algorithm,
    bits: metadata.bits,
    fingerprint: metadata.fingerprint,
    comment: metadata.comment,
    privateKeyPath: metadata.privateKeyPath,
    publicKeyPath: metadata.publicKeyPath,
    source,
    hasPassphrase,
    assignedHostIds: [],
    createdAt: now,
    updatedAt: now,
  };
}

function upsertKey(
  keys: KeyRecord[],
  label: string,
  metadata: KeyMetadata,
  source: KeySource,
  hasPassphrase: boolean
) {
  const existing = keys.find((key) => key.privateKeyPath === metadata.privateKeyPath);
  if (!existing) {
    return sortKeys([...keys, createKeyRecord(label, metadata, source, hasPassphrase)]);
  }

  return sortKeys(
    keys.map((key) =>
      key.id === existing.id
        ? {
            ...key,
            label: label.trim(),
            algorithm: metadata.algorithm,
            bits: metadata.bits,
            fingerprint: metadata.fingerprint,
            comment: metadata.comment,
            publicKeyPath: metadata.publicKeyPath,
            source,
            hasPassphrase,
            updatedAt: new Date().toISOString(),
          }
        : key
    )
  );
}

interface KeysState {
  keys: KeyRecord[];
  /** Record removed by the most recent delete, pending expiry or undo. */
  pendingDeletedKey?: KeyRecord;
  importKey: (label: string, metadata: KeyMetadata, hasPassphrase: boolean) => string;
  addGeneratedKey: (label: string, metadata: KeyMetadata, hasPassphrase: boolean) => string;
  deleteKey: (keyId: string) => KeyRecord | undefined;
  restoreDeletedKey: () => void;
  assignHost: (keyId: string, hostId: string) => void;
  unassignHostFromAll: (hostId: string) => void;
}

export const useKeysStore = create<KeysState>()(
  persist(
    (set, get) => ({
      keys: sortKeys(sampleKeys),
      importKey: (label, metadata, hasPassphrase) => {
        set((state) => ({
          keys: upsertKey(state.keys, label, metadata, "imported", hasPassphrase),
        }));

        const nextKey = get().keys.find((key) => key.privateKeyPath === metadata.privateKeyPath);
        if (nextKey) {
          useVaultSyncStore.getState().clearDeleted("keys", nextKey.id);
        }
        return nextKey?.id ?? "";
      },
      addGeneratedKey: (label, metadata, hasPassphrase) => {
        set((state) => ({
          keys: upsertKey(state.keys, label, metadata, "generated", hasPassphrase),
        }));

        const nextKey = get().keys.find((key) => key.privateKeyPath === metadata.privateKeyPath);
        if (nextKey) {
          useVaultSyncStore.getState().clearDeleted("keys", nextKey.id);
        }
        return nextKey?.id ?? "";
      },
      // UX-13: soft delete with an undo window. The Keychain passphrase GC
      // is deferred to window expiry (or replacement by a newer delete) so
      // Undo within the window keeps the passphrase intact; the vault
      // tombstone is written now and cleared on undo.
      deleteKey: (keyId) => {
        const key = get().keys.find((entry) => entry.id === keyId);
        if (!key) {
          return undefined;
        }

        expireUndoWindowNow(UNDO_WINDOW_KEY, () => {
          const stale = get().pendingDeletedKey;
          set({ pendingDeletedKey: undefined });
          if (stale) {
            void clearKeyPassphraseByFingerprint(stale.fingerprint);
          }
        });
        set((state) => ({
          pendingDeletedKey: key,
          keys: sortKeys(state.keys.filter((entry) => entry.id !== keyId)),
        }));
        useVaultSyncStore.getState().markDeleted("keys", key.id);
        startUndoWindow(UNDO_WINDOW_KEY, UNDO_WINDOW_MS, () => {
          set({ pendingDeletedKey: undefined });
          void clearKeyPassphraseByFingerprint(key.fingerprint);
        });
        return key;
      },
      restoreDeletedKey: () => {
        const stash = get().pendingDeletedKey;
        if (!stash) {
          return;
        }
        cancelUndoWindow(UNDO_WINDOW_KEY);
        useVaultSyncStore.getState().clearDeleted("keys", stash.id);
        set((state) => ({
          pendingDeletedKey: undefined,
          keys: sortKeys([...state.keys, stash]),
        }));
      },
      unassignHostFromAll: (hostId) =>
        set((state) => ({
          keys: sortKeys(
            state.keys.map((key) => ({
              ...key,
              assignedHostIds: key.assignedHostIds.filter((entry) => entry !== hostId),
            }))
          ),
        })),
      assignHost: (keyId, hostId) =>
        set((state) => ({
          keys: sortKeys(
            state.keys.map((key) => ({
              ...key,
              assignedHostIds:
                key.id === keyId
                  ? Array.from(new Set([...key.assignedHostIds, hostId]))
                  : key.assignedHostIds.filter((entry) => entry !== hostId),
              updatedAt:
                key.id === keyId || key.assignedHostIds.includes(hostId)
                  ? new Date().toISOString()
                  : key.updatedAt,
            }))
          ),
        })),
    }),
    {
      name: "terminal-workspace-keys",
      storage: createJSONStorage(() => createTermsnipStorage("terminal-workspace-keys")),
      // UX-13: the undo stash is session-only.
      partialize: (state) => ({ keys: state.keys }),
    }
  )
);
