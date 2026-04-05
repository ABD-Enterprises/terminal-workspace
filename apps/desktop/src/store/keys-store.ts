import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";
import { sampleKeys, type KeyMetadata, type KeyRecord, type KeySource } from "../types/key";
import { useVaultSyncStore } from "./vault-sync-store";

const fallbackStorage: StateStorage = {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
};

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
  importKey: (label: string, metadata: KeyMetadata, hasPassphrase: boolean) => string;
  addGeneratedKey: (label: string, metadata: KeyMetadata, hasPassphrase: boolean) => string;
  deleteKey: (keyId: string) => KeyRecord | undefined;
  assignHost: (keyId: string, hostId: string) => void;
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
      deleteKey: (keyId) => {
        const key = get().keys.find((entry) => entry.id === keyId);
        set((state) => ({
          keys: sortKeys(state.keys.filter((entry) => entry.id !== keyId)),
        }));
        if (key) {
          useVaultSyncStore.getState().markDeleted("keys", key.id);
        }
        return key;
      },
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
      name: "termsnip-keys",
      storage: createJSONStorage(() =>
        typeof window === "undefined" ? fallbackStorage : window.localStorage
      ),
    }
  )
);
