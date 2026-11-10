import type { StateStorage } from "zustand/middleware";
import { invokeTauriCommand, isTauriRuntime } from "./backend-runtime";
import type { VaultDeletionMap } from "../store/vault-sync-store";

// #472: native persistence goes through typed commands in
// src-tauri/src/persistence.rs, which own the table names and every SQL
// statement. The renderer can no longer name a database file or run SQL.
//
// #115: persisted-store localStorage keys moved from the legacy `termsnip-*`
// namespace to `terminal-workspace-*`. `getLocalStorageItem` forward-migrates
// each legacy value to the new key on first read and keeps the legacy key for
// one release so a rollback still finds the data. These store names are also
// the names the native commands accept; each maps to one SQLite table there.
export type PersistedStoreName =
  | "terminal-workspace-hosts"
  | "terminal-workspace-keys"
  | "terminal-workspace-known-hosts"
  | "terminal-workspace-identities"
  | "terminal-workspace-snippets"
  | "terminal-workspace-runbooks";

const LEGACY_STORAGE_PREFIX = "termsnip-";
const STORAGE_PREFIX = "terminal-workspace-";

/** Map a current `terminal-workspace-*` key back to its legacy `termsnip-*`
 *  counterpart, or null when the key isn't in the migrated namespace. */
function legacyStorageKeyFor(name: string): string | null {
  return name.startsWith(STORAGE_PREFIX)
    ? `${LEGACY_STORAGE_PREFIX}${name.slice(STORAGE_PREFIX.length)}`
    : null;
}

const DELETION_KINDS = ["hosts", "keys", "snippets", "knownHosts", "identities"] as const;

type DeletionKind = (typeof DELETION_KINDS)[number];
type LogLevel = "error" | "warn";

function writeFrontendLog(level: LogLevel, message: string) {
  void import("@tauri-apps/plugin-log")
    .then((logger) => logger[level](message))
    .catch(() => undefined);
}

/** One row of the native `deletions` table, as the native commands return it. */
export interface NativeDeletionRecord {
  deletedAt: string;
  id: string;
  kind: DeletionKind;
}

function getLocalStorageItem(name: string) {
  if (typeof window === "undefined") {
    return null;
  }

  const current = window.localStorage.getItem(name);
  if (current !== null) {
    return current;
  }

  // #115: one-time forward-migration from the legacy `termsnip-*` namespace.
  // Copy the legacy value to the new key on first read and leave the legacy
  // key in place for one release so a rollback still finds the data.
  const legacyKey = legacyStorageKeyFor(name);
  if (legacyKey) {
    const legacyValue = window.localStorage.getItem(legacyKey);
    if (legacyValue !== null) {
      window.localStorage.setItem(name, legacyValue);
      return legacyValue;
    }
  }

  return null;
}

function setLocalStorageItem(name: string, value: string) {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(name, value);
  }
}

function removeLocalStorageItem(name: string) {
  if (typeof window !== "undefined") {
    window.localStorage.removeItem(name);
  }
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

function parsePersistedDeletions(value: string): VaultDeletionMap {
  const parsed = JSON.parse(value) as { state?: { deletions?: Partial<VaultDeletionMap> } };
  const deletions = parsed.state?.deletions;
  return {
    ...emptyDeletionMap(),
    ...deletions,
  };
}

function serializeDeletionRows(rows: NativeDeletionRecord[]) {
  const deletions = emptyDeletionMap();
  for (const row of rows) {
    deletions[row.kind].push({
      deletedAt: row.deletedAt,
      id: row.id,
    });
  }

  return JSON.stringify({
    state: { deletions },
    version: 1,
  });
}

async function getNativeStoreItem(name: PersistedStoreName) {
  const payload = await invokeTauriCommand("terminal_workspace_persistence_read_store", {
    request: { store: name },
  });
  if (payload !== null) {
    return payload;
  }

  const localPayload = getLocalStorageItem(name);
  if (localPayload !== null) {
    await setNativeStoreItem(name, localPayload);
  }

  return localPayload;
}

async function setNativeStoreItem(name: PersistedStoreName, value: string) {
  await invokeTauriCommand("terminal_workspace_persistence_write_store", {
    request: { store: name, payload: value },
  });
  setLocalStorageItem(name, value);
}

async function getNativeDeletionItem(name: string) {
  const rows = await invokeTauriCommand("terminal_workspace_persistence_read_deletions");
  if (rows.length > 0) {
    return serializeDeletionRows(rows);
  }

  const localPayload = getLocalStorageItem(name);
  if (localPayload !== null) {
    await setNativeDeletionItem(localPayload);
  }

  return localPayload;
}

// The native command replaces every record in one transaction and rolls the
// whole replace back if any record fails.
async function setNativeDeletionItem(value: string) {
  const deletions = parsePersistedDeletions(value);
  const records: NativeDeletionRecord[] = [];
  for (const kind of DELETION_KINDS) {
    for (const entry of deletions[kind] ?? []) {
      records.push({ kind, id: entry.id, deletedAt: entry.deletedAt });
    }
  }
  await invokeTauriCommand("terminal_workspace_persistence_replace_deletions", {
    request: { records },
  });
}

async function removeNativeStoreItem(name: PersistedStoreName) {
  await invokeTauriCommand("terminal_workspace_persistence_remove_store", {
    request: { store: name },
  });
  removeLocalStorageItem(name);
}

async function removeNativeDeletionItem() {
  await invokeTauriCommand("terminal_workspace_persistence_clear_deletions");
}

function logPersistenceFallback(action: string, name: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  writeFrontendLog("warn", `[termsnip] SQLite persistence ${action} failed for ${name}: ${message}`);
}

// #146: a write/remove that fails must fail LOUDLY and must NOT shadow-write
// localStorage. SQLite is the single source of truth; a localStorage copy that
// is newer than SQLite is exactly the split-brain that later resurrects stale
// SQLite rows on read. Log at error level and let the caller re-throw.
function logPersistenceError(action: string, name: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  writeFrontendLog(
    "error",
    `[termsnip] SQLite persistence ${action} failed for ${name}; not shadow-writing localStorage (SQLite is the source of truth): ${message}`
  );
}

/**
 * #115: localStorage-backed storage that forward-migrates legacy `termsnip-*`
 * keys (see `getLocalStorageItem`). Used by the persisted stores that don't
 * have a native SQLite table (app, sessions, transfers, vault-sync-trust) so
 * their data survives the key-namespace rename without an ordering-sensitive
 * boot migration.
 */
export function createMigratingLocalStorage(): StateStorage {
  return {
    getItem: (name) => getLocalStorageItem(name),
    setItem: (name, value) => setLocalStorageItem(name, value),
    removeItem: (name) => removeLocalStorageItem(name),
  };
}

export function createTermsnipStorage(name: PersistedStoreName): StateStorage {
  return {
    getItem: async () => {
      if (!isTauriRuntime()) {
        return getLocalStorageItem(name);
      }
      try {
        return await getNativeStoreItem(name);
      } catch (error) {
        logPersistenceFallback("getItem", name, error);
        return getLocalStorageItem(name);
      }
    },
    setItem: async (_name, value) => {
      if (!isTauriRuntime()) {
        setLocalStorageItem(name, value);
        return;
      }
      try {
        await setNativeStoreItem(name, value);
      } catch (error) {
        logPersistenceError("setItem", name, error);
        throw error;
      }
    },
    removeItem: async () => {
      if (!isTauriRuntime()) {
        removeLocalStorageItem(name);
        return;
      }
      try {
        await removeNativeStoreItem(name);
      } catch (error) {
        logPersistenceError("removeItem", name, error);
        throw error;
      }
    },
  };
}

export function createTermsnipDeletionStorage(name: string): StateStorage {
  return {
    getItem: async () => {
      if (!isTauriRuntime()) {
        return getLocalStorageItem(name);
      }
      try {
        return await getNativeDeletionItem(name);
      } catch (error) {
        logPersistenceFallback("getItem", name, error);
        return getLocalStorageItem(name);
      }
    },
    setItem: async (_name, value) => {
      if (!isTauriRuntime()) {
        setLocalStorageItem(name, value);
        return;
      }
      try {
        await setNativeDeletionItem(value);
        setLocalStorageItem(name, value);
      } catch (error) {
        logPersistenceError("setItem", name, error);
        throw error;
      }
    },
    removeItem: async () => {
      if (!isTauriRuntime()) {
        removeLocalStorageItem(name);
        return;
      }
      try {
        await removeNativeDeletionItem();
        removeLocalStorageItem(name);
      } catch (error) {
        logPersistenceError("removeItem", name, error);
        throw error;
      }
    },
  };
}
