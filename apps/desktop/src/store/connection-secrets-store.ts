import { create } from "zustand";
import { isTauriRuntime } from "../lib/backend-runtime";
import { resolveHostKeyFingerprint } from "../lib/host-key-fingerprint";
import {
  clearNativeHostSecrets,
  clearNativeKeyPassphrase,
  loadNativeHostSecrets,
  loadNativeKeyPassphrase,
  storeNativeHostSecrets,
  storeNativeKeyPassphrase,
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

function logSecretPersistenceError(
  action: "clear" | "hydrate" | "store" | "migrate",
  scope: string,
  error: unknown
) {
  const message = error instanceof Error ? error.message : String(error);
  console.warn(`Failed to ${action} runtime secrets for ${scope}: ${message}`);
}

/**
 * Load secrets for a host, preferring the per-key-fingerprint Keychain entry
 * for the passphrase when one is available. Falls back to the legacy
 * per-host entry and migrates it forward (write under fingerprint, clear
 * the per-host copy) so existing users keep their saved passphrases on
 * upgrade. See parity-and-hardening-plan.md P1-S5.
 *
 * Password is always loaded from the per-host entry — passwords are
 * intrinsically per-host and have no shared identity to key on.
 */
async function loadSecretsWithFingerprintMigration(
  hostId: string,
  fingerprint: string | undefined
): Promise<ConnectionSecretValues> {
  const perHost = await loadNativeHostSecrets(hostId);
  if (!fingerprint) {
    return perHost;
  }

  const keyedPassphrase = await loadNativeKeyPassphrase(fingerprint);
  if (keyedPassphrase) {
    return { password: perHost.password, passphrase: keyedPassphrase };
  }

  // Migration path: an older build wrote the passphrase under the per-host
  // service. Move it to the per-fingerprint service and drop the legacy
  // entry so the next reader does not have to repeat this dance. Failure
  // here is logged but does not block the load — the user still gets the
  // passphrase even if the migration write fails.
  if (perHost.passphrase) {
    try {
      await storeNativeKeyPassphrase(fingerprint, perHost.passphrase);
      await storeNativeHostSecrets(hostId, {
        password: perHost.password,
        passphrase: "",
      });
    } catch (error) {
      logSecretPersistenceError("migrate", `key:${fingerprint}`, error);
    }
  }

  return perHost;
}

async function persistSecretsWithFingerprintRouting(
  hostId: string,
  fingerprint: string | undefined,
  values: ConnectionSecretValues
): Promise<void> {
  // Password always lives in the per-host entry. The per-host passphrase
  // slot stays empty when we have a fingerprint to key on so that there is
  // exactly one source of truth.
  const perHostPassphrase = fingerprint ? "" : values.passphrase;
  await storeNativeHostSecrets(hostId, {
    password: values.password,
    passphrase: perHostPassphrase,
  });

  if (fingerprint) {
    if (values.passphrase) {
      await storeNativeKeyPassphrase(fingerprint, values.passphrase);
    } else {
      // Removing the passphrase for this host should not silently delete the
      // shared per-fingerprint entry — other hosts using the same key still
      // need it. We leave it alone; explicit GC happens via clearKeyPassphrase.
    }
  }
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

    const fingerprint = resolveHostKeyFingerprint(hostId);
    const hydrationPromise = loadSecretsWithFingerprintMigration(hostId, fingerprint)
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

    const fingerprint = resolveHostKeyFingerprint(hostId);
    const persistPromise = hasConnectionSecrets(values)
      ? persistSecretsWithFingerprintRouting(hostId, fingerprint, values)
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

    // We deliberately do NOT clear the per-fingerprint entry here. Other
    // hosts may share the same key and still need the passphrase. Per-
    // fingerprint cleanup happens explicitly when the key is deleted from
    // the keys store (see `useKeysStore.deleteKey` GC hook).
    void clearNativeHostSecrets(hostId).catch((error) => {
      logSecretPersistenceError("clear", hostId, error);
    });
  },
}));

/**
 * Garbage-collect the per-fingerprint Keychain entry for a key that is being
 * removed from the keys store. Safe to call from any runtime — no-ops in
 * the browser and swallows native errors so a failed GC does not block the
 * key deletion. See parity-and-hardening-plan.md P1-S5.
 */
export async function clearKeyPassphraseByFingerprint(
  fingerprint: string | undefined
): Promise<void> {
  if (!fingerprint || !fingerprint.includes(":") || !isTauriRuntime()) {
    return;
  }
  try {
    await clearNativeKeyPassphrase(fingerprint);
  } catch (error) {
    logSecretPersistenceError("clear", `key:${fingerprint}`, error);
  }
}

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
