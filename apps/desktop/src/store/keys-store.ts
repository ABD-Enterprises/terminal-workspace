import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { createTermsnipStorage } from "../lib/persistence";
import { cancelUndoWindow, expireUndoWindowNow, restoredUpdatedAt, startUndoWindow } from "../lib/undo-delete";
import { sampleKeys, type KeyMetadata, type KeyRecord, type KeySource } from "../types/key";
import { clearKeyPassphraseByFingerprint } from "./connection-secrets-store";
import { useVaultSyncStore } from "./vault-sync-store";

// UX-13: undoable delete — same contract as the snippets store. The Keychain
// passphrase GC and the vault tombstone are what undo protects: the GC is
// deferred to window expiry so an undo within the window keeps the stored
// passphrase usable.
const UNDO_WINDOW_KEY = "keys:delete";
const UNDO_WINDOW_MS = 5_000;

function isClearableFingerprint(fingerprint: string | undefined): fingerprint is string {
  return Boolean(fingerprint) && fingerprint!.includes(":");
}

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
  /**
   * Fingerprints whose Keychain passphrase still has to be cleared. Unlike
   * the undo stash this is persisted, so quitting inside the undo window
   * cannot leave a deleted key's passphrase behind: it is cleared at the
   * next start (see reconcilePendingKeyCleanups). Holds fingerprints only.
   */
  pendingPassphraseCleanups: string[];
  importKey: (label: string, metadata: KeyMetadata, hasPassphrase: boolean) => string;
  addGeneratedKey: (label: string, metadata: KeyMetadata, hasPassphrase: boolean) => string;
  deleteKey: (keyId: string) => KeyRecord | undefined;
  /**
   * Restore the pending deleted key, but only if it is the one named by
   * `keyId`, so an Undo bound to an older deletion cannot restore a newer one.
   */
  restoreDeletedKey: (keyId: string) => KeyRecord | undefined;
  /**
   * Clear the Keychain passphrase of every fingerprint left in
   * `pendingPassphraseCleanups` that no current key uses. Runs at startup.
   */
  reconcilePendingCleanups: () => void;
  assignHost: (keyId: string, hostId: string) => void;
  unassignHostFromAll: (hostId: string) => void;
}

export const useKeysStore = create<KeysState>()(
  persist(
    (set, get) => ({
      keys: sortKeys(sampleKeys),
      pendingPassphraseCleanups: [],
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

        // Finalise a deletion: forget the pending cleanup, drop the stash if
        // it still belongs to this key, and clear the Keychain passphrase
        // unless another key record now uses the same fingerprint.
        const finalize = (deleted: KeyRecord) => {
          const stillUsed = get().keys.some((entry) => entry.fingerprint === deleted.fingerprint);
          set((state) => ({
            pendingDeletedKey:
              state.pendingDeletedKey?.id === deleted.id ? undefined : state.pendingDeletedKey,
            pendingPassphraseCleanups: state.pendingPassphraseCleanups.filter(
              (entry) => entry !== deleted.fingerprint
            ),
          }));
          if (!stillUsed) {
            void clearKeyPassphraseByFingerprint(deleted.fingerprint);
          }
        };

        const stale = get().pendingDeletedKey;
        expireUndoWindowNow(UNDO_WINDOW_KEY, () => {
          if (stale) {
            finalize(stale);
          }
        });
        // The removal and the durable cleanup record are one state change, so
        // they are persisted together.
        set((state) => ({
          pendingDeletedKey: key,
          pendingPassphraseCleanups: isClearableFingerprint(key.fingerprint)
            ? Array.from(new Set([...state.pendingPassphraseCleanups, key.fingerprint]))
            : state.pendingPassphraseCleanups,
          keys: sortKeys(state.keys.filter((entry) => entry.id !== keyId)),
        }));
        useVaultSyncStore.getState().markDeleted("keys", key.id);
        startUndoWindow(UNDO_WINDOW_KEY, UNDO_WINDOW_MS, () => finalize(key));
        return key;
      },
      restoreDeletedKey: (keyId) => {
        const stash = get().pendingDeletedKey;
        if (!stash || stash.id !== keyId) {
          return undefined;
        }
        cancelUndoWindow(UNDO_WINDOW_KEY);
        const restored = {
          ...stash,
          updatedAt: restoredUpdatedAt("keys", stash.id, stash.updatedAt),
        };
        useVaultSyncStore.getState().clearDeleted("keys", stash.id);
        set((state) => ({
          pendingDeletedKey: undefined,
          pendingPassphraseCleanups: state.pendingPassphraseCleanups.filter(
            (entry) => entry !== stash.fingerprint
          ),
          keys: sortKeys([...state.keys, restored]),
        }));
        return restored;
      },
      reconcilePendingCleanups: () => {
        // A live undo window owns its own fingerprint; leave that one alone.
        const live = get().pendingDeletedKey?.fingerprint;
        const due = get().pendingPassphraseCleanups.filter((entry) => entry !== live);
        if (due.length === 0) {
          return;
        }
        const inUse = new Set(get().keys.map((entry) => entry.fingerprint));
        set((state) => ({
          pendingPassphraseCleanups: state.pendingPassphraseCleanups.filter(
            (entry) => !due.includes(entry)
          ),
        }));
        for (const fingerprint of due) {
          if (!inUse.has(fingerprint)) {
            void clearKeyPassphraseByFingerprint(fingerprint);
          }
        }
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
      // UX-13: the undo stash is session-only, but the pending Keychain
      // cleanups are persisted so they survive quitting inside the window.
      partialize: (state) => ({
        keys: state.keys,
        pendingPassphraseCleanups: state.pendingPassphraseCleanups,
      }),
      onRehydrateStorage: () => () => {
        // Run after the store is assigned (hydration may finish synchronously).
        setTimeout(() => useKeysStore.getState().reconcilePendingCleanups(), 0);
      },
    }
  )
);
