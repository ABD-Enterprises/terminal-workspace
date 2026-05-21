import Database from "@tauri-apps/plugin-sql";
import type { StateStorage } from "zustand/middleware";
import { isTauriRuntime } from "./backend-runtime";
import type { VaultDeletionMap } from "../store/vault-sync-store";

const DATABASE_URL = "sqlite:termsnip.db";

const STORE_TABLES = {
  "termsnip-hosts": "hosts_store",
  "termsnip-keys": "keys_store",
  "termsnip-known-hosts": "known_hosts_store",
  "termsnip-identities": "identities_store",
  "termsnip-snippets": "snippets_store",
} as const;

const DELETION_KINDS = ["hosts", "keys", "snippets", "knownHosts", "identities"] as const;

type PersistedStoreName = keyof typeof STORE_TABLES;
type DeletionKind = (typeof DELETION_KINDS)[number];

interface StorePayloadRow {
  payload: string;
}

interface DeletionRow {
  deleted_at: string;
  id: string;
  kind: DeletionKind;
}

let databasePromise: Promise<Database> | undefined;

function getLocalStorageItem(name: string) {
  if (typeof window === "undefined") {
    return null;
  }

  return window.localStorage.getItem(name);
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

function loadDatabase() {
  databasePromise ??= Database.load(DATABASE_URL).catch((error) => {
    databasePromise = undefined;
    throw error;
  });
  return databasePromise;
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

function serializeDeletionRows(rows: DeletionRow[]) {
  const deletions = emptyDeletionMap();
  for (const row of rows) {
    deletions[row.kind].push({
      deletedAt: row.deleted_at,
      id: row.id,
    });
  }

  return JSON.stringify({
    state: { deletions },
    version: 1,
  });
}

async function getNativeStoreItem(name: PersistedStoreName) {
  const tableName = STORE_TABLES[name];
  const db = await loadDatabase();
  const rows = await db.select<StorePayloadRow[]>(
    `SELECT payload FROM ${tableName} WHERE id = $1 LIMIT 1`,
    ["state"]
  );
  const payload = rows[0]?.payload ?? null;
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
  const tableName = STORE_TABLES[name];
  const db = await loadDatabase();
  await db.execute(
    `INSERT INTO ${tableName} (id, payload, updated_at)
       VALUES ($1, $2, datetime('now'))
       ON CONFLICT(id) DO UPDATE SET
         payload = excluded.payload,
         updated_at = excluded.updated_at`,
    ["state", value]
  );
}

async function getNativeDeletionItem(name: string) {
  const db = await loadDatabase();
  const rows = await db.select<DeletionRow[]>(
    "SELECT kind, id, deleted_at FROM deletions ORDER BY deleted_at DESC"
  );
  if (rows.length > 0) {
    return serializeDeletionRows(rows);
  }

  const localPayload = getLocalStorageItem(name);
  if (localPayload !== null) {
    await setNativeDeletionItem(localPayload);
  }

  return localPayload;
}

async function setNativeDeletionItem(value: string) {
  const db = await loadDatabase();
  const deletions = parsePersistedDeletions(value);
  await db.execute("DELETE FROM deletions");

  for (const kind of DELETION_KINDS) {
    for (const entry of deletions[kind] ?? []) {
      await db.execute(
        `INSERT INTO deletions (kind, id, deleted_at)
           VALUES ($1, $2, $3)
           ON CONFLICT(kind, id) DO UPDATE SET deleted_at = excluded.deleted_at`,
        [kind, entry.id, entry.deletedAt]
      );
    }
  }
}

async function removeNativeStoreItem(name: PersistedStoreName) {
  const db = await loadDatabase();
  await db.execute(`DELETE FROM ${STORE_TABLES[name]} WHERE id = $1`, ["state"]);
}

async function removeNativeDeletionItem() {
  const db = await loadDatabase();
  await db.execute("DELETE FROM deletions");
}

function logPersistenceFallback(action: string, name: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  console.warn(`[termsnip] SQLite persistence ${action} failed for ${name}: ${message}`);
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
        logPersistenceFallback("setItem", name, error);
        setLocalStorageItem(name, value);
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
        logPersistenceFallback("removeItem", name, error);
        removeLocalStorageItem(name);
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
      } catch (error) {
        logPersistenceFallback("setItem", name, error);
        setLocalStorageItem(name, value);
      }
    },
    removeItem: async () => {
      if (!isTauriRuntime()) {
        removeLocalStorageItem(name);
        return;
      }
      try {
        await removeNativeDeletionItem();
      } catch (error) {
        logPersistenceFallback("removeItem", name, error);
        removeLocalStorageItem(name);
      }
    },
  };
}
