import { create } from "zustand";
import { isTauriRuntime } from "../lib/backend-runtime";
import {
  clearNativeHostSecrets,
  loadNativeHostSecrets,
  storeNativeHostSecrets,
} from "../lib/native-secrets";

export interface ConnectionSecretRecord {
  password: string;
  passphrase: string;
  updatedAt: string;
}

interface ConnectionSecretValues {
  password: string;
  passphrase: string;
}

interface ConnectionSecretsState {
  secretsByHostId: Record<string, ConnectionSecretRecord>;
  hydrateHostSecrets: (hostId: string) => Promise<ConnectionSecretRecord | undefined>;
  setHostSecrets: (hostId: string, values: ConnectionSecretValues) => void;
  clearHostSecrets: (hostId: string) => void;
}

const hydrationPromises = new Map<string, Promise<ConnectionSecretRecord | undefined>>();

function hasConnectionSecrets(values: ConnectionSecretValues) {
  return Boolean(values.password || values.passphrase);
}

function buildSecretRecord(values: ConnectionSecretValues): ConnectionSecretRecord {
  return {
    password: values.password,
    passphrase: values.passphrase,
    updatedAt: new Date().toISOString(),
  };
}

function logSecretPersistenceError(action: "clear" | "hydrate" | "store", hostId: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  console.warn(`Failed to ${action} runtime secrets for ${hostId}: ${message}`);
}

export const useConnectionSecretsStore = create<ConnectionSecretsState>((set, get) => ({
  secretsByHostId: {},
  hydrateHostSecrets: async (hostId): Promise<ConnectionSecretRecord | undefined> => {
    const existingRecord = get().secretsByHostId[hostId];
    if (existingRecord || !isTauriRuntime()) {
      return existingRecord;
    }

    const pendingHydration = hydrationPromises.get(hostId);
    if (pendingHydration) {
      return pendingHydration;
    }

    const hydrationPromise = loadNativeHostSecrets(hostId)
      .then((values) => {
        if (!hasConnectionSecrets(values)) {
          return undefined;
        }

        const currentRecord = get().secretsByHostId[hostId];
        if (currentRecord) {
          return currentRecord;
        }

        const nextRecord = buildSecretRecord(values);
        set((state) => ({
          secretsByHostId: {
            ...state.secretsByHostId,
            [hostId]: nextRecord,
          },
        }));
        return nextRecord;
      })
      .catch((error) => {
        logSecretPersistenceError("hydrate", hostId, error);
        return undefined;
      })
      .finally(() => {
        hydrationPromises.delete(hostId);
      });

    hydrationPromises.set(hostId, hydrationPromise);
    return hydrationPromise;
  },
  setHostSecrets: (hostId, values) => {
    if (hasConnectionSecrets(values)) {
      set((state) => ({
        secretsByHostId: {
          ...state.secretsByHostId,
          [hostId]: buildSecretRecord(values),
        },
      }));
    } else {
      set((state) => {
        const nextSecrets = { ...state.secretsByHostId };
        delete nextSecrets[hostId];

        return {
          secretsByHostId: nextSecrets,
        };
      });
    }

    if (!isTauriRuntime()) {
      return;
    }

    const persistPromise = hasConnectionSecrets(values)
      ? storeNativeHostSecrets(hostId, values)
      : clearNativeHostSecrets(hostId);

    void persistPromise.catch((error) => {
      logSecretPersistenceError(hasConnectionSecrets(values) ? "store" : "clear", hostId, error);
    });
  },
  clearHostSecrets: (hostId) => {
    set((state) => {
      const nextSecrets = { ...state.secretsByHostId };
      delete nextSecrets[hostId];

      return {
        secretsByHostId: nextSecrets,
      };
    });

    if (!isTauriRuntime()) {
      return;
    }

    void clearNativeHostSecrets(hostId).catch((error) => {
      logSecretPersistenceError("clear", hostId, error);
    });
  },
}));

export async function hydrateHostConnectionSecrets(hostId: string) {
  return useConnectionSecretsStore.getState().hydrateHostSecrets(hostId);
}

export function getHostConnectionSecrets(hostId: string) {
  const record = useConnectionSecretsStore.getState().secretsByHostId[hostId];

  return {
    password: record?.password ?? "",
    passphrase: record?.passphrase ?? "",
  };
}

export function resetConnectionSecretsStoreForTests() {
  hydrationPromises.clear();
  useConnectionSecretsStore.setState({
    secretsByHostId: {},
  });
}
