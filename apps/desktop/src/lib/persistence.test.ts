import { beforeEach, describe, expect, it, vi } from "vitest";
import type { VaultDeletionMap } from "../store/vault-sync-store";

type StoreTable =
  | "hosts_store"
  | "keys_store"
  | "known_hosts_store"
  | "identities_store"
  | "snippets_store";

interface FakeDatabaseOptions {
  failLoad?: boolean;
  failSelect?: boolean;
  failExecuteOn?: RegExp;
}

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(name: string) {
    return this.values.get(name) ?? null;
  }

  removeItem(name: string) {
    this.values.delete(name);
  }

  setItem(name: string, value: string) {
    this.values.set(name, value);
  }
}

class FakeDatabase {
  readonly deletions = new Map<string, { deleted_at: string; id: string; kind: string }>();
  readonly executeCalls: string[] = [];
  readonly stores = new Map<StoreTable, string>();
  private deletionSnapshot: Map<string, { deleted_at: string; id: string; kind: string }> | undefined;

  constructor(private readonly options: FakeDatabaseOptions = {}) {}

  async select<T>(sql: string): Promise<T> {
    if (this.options.failSelect) {
      throw new Error("select failed");
    }

    const storeTable = this.storeTableFromSql(sql);
    if (storeTable) {
      const payload = this.stores.get(storeTable);
      return (payload ? [{ payload }] : []) as T;
    }

    if (sql.includes("FROM deletions")) {
      return [...this.deletions.values()].sort((left, right) =>
        right.deleted_at.localeCompare(left.deleted_at)
      ) as T;
    }

    return [] as T;
  }

  async execute(sql: string, params: unknown[] = []) {
    this.executeCalls.push(sql);
    if (this.options.failExecuteOn?.test(sql)) {
      throw new Error("execute failed");
    }

    if (sql === "BEGIN IMMEDIATE TRANSACTION") {
      this.deletionSnapshot = new Map(this.deletions);
      return;
    }

    if (sql === "ROLLBACK") {
      if (this.deletionSnapshot) {
        this.deletions.clear();
        for (const [key, value] of this.deletionSnapshot) {
          this.deletions.set(key, value);
        }
      }
      this.deletionSnapshot = undefined;
      return;
    }

    if (sql === "COMMIT") {
      this.deletionSnapshot = undefined;
      return;
    }

    const storeTable = this.storeTableFromSql(sql);
    if (storeTable && sql.includes("INSERT INTO")) {
      this.stores.set(storeTable, String(params[1]));
      return;
    }

    if (storeTable && sql.includes("DELETE FROM")) {
      this.stores.delete(storeTable);
      return;
    }

    if (sql === "DELETE FROM deletions") {
      this.deletions.clear();
      return;
    }

    if (sql.includes("INSERT INTO deletions")) {
      const [kind, id, deletedAt] = params.map(String);
      this.deletions.set(`${kind}:${id}`, { deleted_at: deletedAt, id, kind });
    }
  }

  private storeTableFromSql(sql: string): StoreTable | undefined {
    for (const table of [
      "hosts_store",
      "keys_store",
      "known_hosts_store",
      "identities_store",
      "snippets_store",
    ] as const) {
      if (sql.includes(table)) {
        return table;
      }
    }
    return undefined;
  }
}

function serializeDeletions(deletions: Partial<VaultDeletionMap>) {
  return JSON.stringify({
    state: { deletions },
    version: 1,
  });
}

async function loadPersistence(db: FakeDatabase, options: FakeDatabaseOptions = {}) {
  const localStorage = new MemoryStorage();
  vi.stubGlobal("window", { localStorage });
  vi.doMock("./backend-runtime", () => ({ isTauriRuntime: () => true }));
  vi.doMock("@tauri-apps/plugin-sql", () => ({
    default: {
      load: vi.fn(async () => {
        if (options.failLoad) {
          throw new Error("load failed");
        }
        return db;
      }),
    },
  }));

  const persistence = await import("./persistence");
  return { localStorage, persistence };
}

describe("Tauri SQLite persistence", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("migrates localStorage payloads into SQLite and mirrors successful writes", async () => {
    const db = new FakeDatabase();
    const { localStorage, persistence } = await loadPersistence(db);
    const storage = persistence.createTermsnipStorage("terminal-workspace-hosts");
    localStorage.setItem("terminal-workspace-hosts", "local-payload");

    await expect(storage.getItem("terminal-workspace-hosts")).resolves.toBe("local-payload");
    expect(db.stores.get("hosts_store")).toBe("local-payload");

    await storage.setItem("terminal-workspace-hosts", "sqlite-payload");
    expect(db.stores.get("hosts_store")).toBe("sqlite-payload");
    expect(localStorage.getItem("terminal-workspace-hosts")).toBe("sqlite-payload");

    await storage.removeItem("terminal-workspace-hosts");
    expect(db.stores.has("hosts_store")).toBe(false);
    expect(localStorage.getItem("terminal-workspace-hosts")).toBeNull();
  });

  it("#115: forward-migrates a legacy termsnip-* key, keeping the old key for rollback", async () => {
    const { localStorage, persistence } = await loadPersistence(new FakeDatabase());
    // Data exists only under the legacy namespace; the new key is absent.
    localStorage.setItem("termsnip-app", "legacy-payload");
    const storage = persistence.createMigratingLocalStorage();

    // Reading the new key returns the legacy value, copies it forward, and
    // leaves the legacy key in place so a rollback still finds the data.
    expect(storage.getItem("terminal-workspace-app")).toBe("legacy-payload");
    expect(localStorage.getItem("terminal-workspace-app")).toBe("legacy-payload");
    expect(localStorage.getItem("termsnip-app")).toBe("legacy-payload");
  });

  it("falls back to localStorage when a SQLite READ (load or select) fails", async () => {
    const selectDb = new FakeDatabase({ failSelect: true });
    const selectHarness = await loadPersistence(selectDb);
    selectHarness.localStorage.setItem("terminal-workspace-hosts", "fallback-payload");
    await expect(
      selectHarness.persistence.createTermsnipStorage("terminal-workspace-hosts").getItem("terminal-workspace-hosts")
    ).resolves.toBe("fallback-payload");

    vi.resetModules();
    vi.unstubAllGlobals();
    const loadHarness = await loadPersistence(new FakeDatabase(), { failLoad: true });
    loadHarness.localStorage.setItem("terminal-workspace-hosts", "load-fallback");
    await expect(
      loadHarness.persistence.createTermsnipStorage("terminal-workspace-hosts").getItem("terminal-workspace-hosts")
    ).resolves.toBe("load-fallback");
  });

  it("#146: a SQLite write failure rejects and does NOT shadow-write localStorage", async () => {
    const harness = await loadPersistence(
      new FakeDatabase({ failExecuteOn: /INSERT INTO hosts_store/ })
    );
    const storage = harness.persistence.createTermsnipStorage("terminal-workspace-hosts");
    // localStorage already mirrors the last good SQLite value.
    harness.localStorage.setItem("terminal-workspace-hosts", "old-value");

    await expect(
      storage.setItem("terminal-workspace-hosts", "new-value")
    ).rejects.toThrow(/execute failed/);

    // The failed write must NOT leave a localStorage copy newer than SQLite —
    // that split-brain is exactly what later resurrects the stale SQLite row.
    expect(harness.localStorage.getItem("terminal-workspace-hosts")).toBe("old-value");
  });

  it("#146: a SQLite delete failure rejects and does NOT shadow-remove localStorage", async () => {
    const harness = await loadPersistence(
      new FakeDatabase({ failExecuteOn: /DELETE FROM hosts_store/ })
    );
    const storage = harness.persistence.createTermsnipStorage("terminal-workspace-hosts");
    harness.localStorage.setItem("terminal-workspace-hosts", "still-here");

    await expect(
      storage.removeItem("terminal-workspace-hosts")
    ).rejects.toThrow(/execute failed/);
    expect(harness.localStorage.getItem("terminal-workspace-hosts")).toBe("still-here");
  });

  it("mirrors a successful deletion write to localStorage", async () => {
    const db = new FakeDatabase();
    const { localStorage, persistence } = await loadPersistence(db);
    const storage = persistence.createTermsnipDeletionStorage("terminal-workspace-vault-sync");

    await storage.setItem(
      "terminal-workspace-vault-sync",
      serializeDeletions({
        hosts: [{ deletedAt: "2026-02-01T00:00:00.000Z", id: "new" }],
      })
    );

    expect(db.deletions.get("hosts:new")).toBeDefined();
    expect(localStorage.getItem("terminal-workspace-vault-sync")).toContain('"id":"new"');
  });

  it("#146: a failed deletion write rolls back SQLite and does NOT shadow-write localStorage", async () => {
    const db = new FakeDatabase({ failExecuteOn: /INSERT INTO deletions/ });
    db.deletions.set("hosts:old", {
      deleted_at: "2026-01-01T00:00:00.000Z",
      id: "old",
      kind: "hosts",
    });
    const { localStorage, persistence } = await loadPersistence(db);
    const storage = persistence.createTermsnipDeletionStorage("terminal-workspace-vault-sync");

    await expect(
      storage.setItem(
        "terminal-workspace-vault-sync",
        serializeDeletions({
          hosts: [{ deletedAt: "2026-02-01T00:00:00.000Z", id: "new" }],
        })
      )
    ).rejects.toThrow(/execute failed/);

    // SQLite rolled back to the prior tombstone set...
    expect(db.deletions.get("hosts:old")).toEqual({
      deleted_at: "2026-01-01T00:00:00.000Z",
      id: "old",
      kind: "hosts",
    });
    expect(db.executeCalls).toContain("BEGIN IMMEDIATE TRANSACTION");
    expect(db.executeCalls).toContain("ROLLBACK");
    // ...and localStorage was NOT shadow-written with the un-committed tombstone.
    expect(localStorage.getItem("terminal-workspace-vault-sync")).toBeNull();
  });
});
