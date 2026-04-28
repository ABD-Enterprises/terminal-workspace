import { create } from "zustand";
import { isTauriRuntime } from "../lib/backend-runtime";
import { resolveHostIdentity } from "../lib/host-identity-resolver";
import { resolveHostKeyFingerprint } from "../lib/host-key-fingerprint";
import {
  clearNativeHostSecrets,
  clearNativeIdentityPassphrase,
  clearNativeKeyPassphrase,
  loadNativeHostSecrets,
  loadNativeIdentityPassphrase,
  loadNativeKeyPassphrase,
  storeNativeHostSecrets,
  storeNativeIdentityPassphrase,
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
 * Load secrets for a host, walking the three Keychain services in priority
 * order (identity → fingerprint → host) and migrating forward whenever an
 * older entry is found before a newer one. Password is always loaded from
 * the per-host entry — passwords are intrinsically per-host.
 *
 * P2-DM1 batch 3 introduces the per-identity service as the canonical home;
 * the per-fingerprint service from P1-S5 and the legacy per-host service
 * remain readable so existing users keep their saved passphrases on
 * upgrade. Migration failures log and continue — the user still gets the
 * passphrase even if the forward-write fails.
 */
async function loadSecretsWithMultiStageMigration(
  hostId: string,
  identityId: string | undefined,
  fingerprint: string | undefined
): Promise<ConnectionSecretValues> {
  const perHost = await loadNativeHostSecrets(hostId);

  // Stage 1: per-identity (canonical).
  if (identityId) {
    const identityPassphrase = await loadNativeIdentityPassphrase(identityId);
    if (identityPassphrase) {
      return { password: perHost.password, passphrase: identityPassphrase };
    }
  }

  // Stage 2: per-fingerprint (P1-S5 transitional). If found and we have an
  // identity, migrate forward to the identity service.
  if (fingerprint) {
    const keyedPassphrase = await loadNativeKeyPassphrase(fingerprint);
    if (keyedPassphrase) {
      if (identityId) {
        try {
          await storeNativeIdentityPassphrase(identityId, keyedPassphrase);
          // Leave the per-fingerprint entry in place — other hosts that
          // share the key but lack an identity binding may still need it.
          // GC happens explicitly when the key is deleted.
        } catch (error) {
          logSecretPersistenceError("migrate", `identity:${identityId}`, error);
        }
      }
      return { password: perHost.password, passphrase: keyedPassphrase };
    }
  }

  // Stage 3: legacy per-host passphrase. Migrate forward to identity (if
  // bound) or to fingerprint (P1-S5 transitional behaviour).
  if (perHost.passphrase) {
    if (identityId) {
      try {
        await storeNativeIdentityPassphrase(identityId, perHost.passphrase);
        await storeNativeHostSecrets(hostId, {
          password: perHost.password,
          passphrase: "",
        });
      } catch (error) {
        logSecretPersistenceError("migrate", `identity:${identityId}`, error);
      }
    } else if (fingerprint) {
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
  }

  return perHost;
}

async function persistSecretsWithIdentityRouting(
  hostId: string,
  identityId: string | undefined,
  fingerprint: string | undefined,
  values: ConnectionSecretValues
): Promise<void> {
  // Password always lives in the per-host entry. The per-host passphrase
  // slot stays empty whenever we have a more-specific home (identity or
  // fingerprint) so there is exactly one source of truth.
  const perHostPassphrase = identityId || fingerprint ? "" : values.passphrase;
  await storeNativeHostSecrets(hostId, {
    password: values.password,
    passphrase: perHostPassphrase,
  });

  if (identityId) {
    if (values.passphrase) {
      await storeNativeIdentityPassphrase(identityId, values.passphrase);
    }
    // Removing the passphrase for one host should not silently delete the
    // shared per-identity entry — other hosts that share the identity
    // still need it. Explicit GC happens via clearIdentityPassphrase
    // (called when the identity is deleted from the identities store).
    return;
  }

  if (fingerprint && values.passphrase) {
    // Backward compat: hosts not yet bound to an identity continue to use
    // the per-fingerprint service. They will migrate forward next time
    // they are loaded after the user binds an identity.
    await storeNativeKeyPassphrase(fingerprint, values.passphrase);
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
    const identityId = resolveHostIdentity(hostId)?.id;
    const hydrationPromise = loadSecretsWithMultiStageMigration(hostId, identityId, fingerprint)
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
    const identityId = resolveHostIdentity(hostId)?.id;
    const persistPromise = hasConnectionSecrets(values)
      ? persistSecretsWithIdentityRouting(hostId, identityId, fingerprint, values)
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

/**
 * Garbage-collect the per-identity Keychain entry for an identity that is
 * being removed from the identities store. Safe to call from any runtime
 * — no-ops in the browser and swallows native errors so a failed GC does
 * not block the identity deletion. See parity-and-hardening-plan.md
 * P2-DM1 batch 3.
 */
export async function clearIdentityPassphraseById(
  identityId: string | undefined
): Promise<void> {
  if (!identityId?.trim() || !isTauriRuntime()) {
    return;
  }
  try {
    await clearNativeIdentityPassphrase(identityId);
  } catch (error) {
    logSecretPersistenceError("clear", `identity:${identityId}`, error);
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
