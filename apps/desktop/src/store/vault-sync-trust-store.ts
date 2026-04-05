import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";
import type { VaultSyncTrustPolicy, VaultSyncTrustedKey } from "../lib/vault-sync-contract";

const fallbackStorage: StateStorage = {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
};

function sortTrustedKeys(keys: VaultSyncTrustedKey[]) {
  return [...keys].sort((left, right) => {
    if (left.validFrom !== right.validFrom) {
      return right.validFrom.localeCompare(left.validFrom);
    }

    return left.keyId.localeCompare(right.keyId);
  });
}

function normalizeTrustedKey(key: VaultSyncTrustedKey): VaultSyncTrustedKey {
  const normalizeOptionalIds = (ids: string[] | null) =>
    ids ? Array.from(new Set(ids.filter(Boolean))).sort((left, right) => left.localeCompare(right)) : null;

  return {
    ...key,
    allowedVaultIds: normalizeOptionalIds(key.allowedVaultIds),
    replacementKeyIds: Array.from(new Set(key.replacementKeyIds.filter(Boolean))).sort((left, right) =>
      left.localeCompare(right)
    ),
  };
}

function createEmptyTrustPolicy(): VaultSyncTrustPolicy {
  return {
    schema: "termsnip-vault-sync-trust",
    version: 1,
    allowUnknownKeys: false,
    trustedKeys: [],
  };
}

interface VaultSyncTrustState {
  policy: VaultSyncTrustPolicy;
  setAllowUnknownKeys: (allowUnknownKeys: boolean) => void;
  upsertTrustedKey: (key: VaultSyncTrustedKey) => void;
  removeTrustedKey: (keyId: string) => void;
  replacePolicy: (policy: VaultSyncTrustPolicy) => void;
}

export const useVaultSyncTrustStore = create<VaultSyncTrustState>()(
  persist(
    (set) => ({
      policy: createEmptyTrustPolicy(),
      setAllowUnknownKeys: (allowUnknownKeys) =>
        set((state) => ({
          policy: {
            ...state.policy,
            allowUnknownKeys,
          },
        })),
      upsertTrustedKey: (key) =>
        set((state) => ({
          policy: {
            ...state.policy,
            trustedKeys: sortTrustedKeys([
              normalizeTrustedKey(key),
              ...state.policy.trustedKeys.filter((entry) => entry.keyId !== key.keyId),
            ]),
          },
        })),
      removeTrustedKey: (keyId) =>
        set((state) => ({
          policy: {
            ...state.policy,
            trustedKeys: sortTrustedKeys(
              state.policy.trustedKeys.filter((entry) => entry.keyId !== keyId)
            ),
          },
        })),
      replacePolicy: (policy) =>
        set({
          policy: {
            schema: "termsnip-vault-sync-trust",
            version: 1,
            allowUnknownKeys: policy.allowUnknownKeys,
            trustedKeys: sortTrustedKeys(policy.trustedKeys.map(normalizeTrustedKey)),
          },
        }),
    }),
    {
      name: "termsnip-vault-sync-trust",
      version: 1,
      storage: createJSONStorage(() =>
        typeof window === "undefined" ? fallbackStorage : window.localStorage
      ),
      partialize: (state) => ({
        policy: state.policy,
      }),
    }
  )
);
