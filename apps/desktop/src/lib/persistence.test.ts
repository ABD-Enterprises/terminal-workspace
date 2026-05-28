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
    const storage = persistence.createTermsnipStorage("termsnip-hosts");
    localStorage.setItem("termsnip-hosts", "local-payload");

    await expect(storage.getItem("termsnip-hosts")).resolves.toBe("local-payload");
    expect(db.stores.get("hosts_store")).toBe("local-payload");

    await storage.setItem("termsnip-hosts", "sqlite-payload");
    expect(db.stores.get("hosts_store")).toBe("sqlite-payload");
    expect(localStorage.getItem("termsnip-hosts")).toBe("sqlite-payload");

    await storage.removeItem("termsnip-hosts");
    expect(db.stores.has("hosts_store")).toBe(false);
    expect(localStorage.getItem("termsnip-hosts")).toBeNull();
  });

  it("falls back to localStorage when SQLite load, select, or execute fails", async () => {
    const selectDb = new FakeDatabase({ failSelect: true });
    const selectHarness = await loadPersistence(selectDb);
    selectHarness.localStorage.setItem("termsnip-hosts", "fallback-payload");
    await expect(
      selectHarness.persistence.createTermsnipStorage("termsnip-hosts").getItem("termsnip-hosts")
    ).resolves.toBe("fallback-payload");

    vi.resetModules();
    vi.unstubAllGlobals();
    const loadHarness = await loadPersistence(new FakeDatabase(), { failLoad: true });
    loadHarness.localStorage.setItem("termsnip-hosts", "load-fallback");
    await expect(
      loadHarness.persistence.createTermsnipStorage("termsnip-hosts").getItem("termsnip-hosts")
    ).resolves.toBe("load-fallback");

    vi.resetModules();
    vi.unstubAllGlobals();
    const executeHarness = await loadPersistence(
      new FakeDatabase({ failExecuteOn: /INSERT INTO hosts_store/ })
    );
    const executeStorage = executeHarness.persistence.createTermsnipStorage("termsnip-hosts");
    await executeStorage.setItem("termsnip-hosts", "execute-fallback");
    expect(executeHarness.localStorage.getItem("termsnip-hosts")).toBe("execute-fallback");
  });

  it("updates deletion tombstones atomically and rolls back failed writes", async () => {
    const db = new FakeDatabase({ failExecuteOn: /INSERT INTO deletions/ });
    db.deletions.set("hosts:old", {
      deleted_at: "2026-01-01T00:00:00.000Z",
      id: "old",
      kind: "hosts",
    });
    const { localStorage, persistence } = await loadPersistence(db);
    const storage = persistence.createTermsnipDeletionStorage("termsnip-vault-sync");

    await storage.setItem(
      "termsnip-vault-sync",
      serializeDeletions({
        hosts: [{ deletedAt: "2026-02-01T00:00:00.000Z", id: "new" }],
      })
    );

    expect(db.deletions.get("hosts:old")).toEqual({
      deleted_at: "2026-01-01T00:00:00.000Z",
      id: "old",
      kind: "hosts",
    });
    expect(db.executeCalls).toContain("BEGIN IMMEDIATE TRANSACTION");
    expect(db.executeCalls).toContain("ROLLBACK");
    expect(localStorage.getItem("termsnip-vault-sync")).toContain('"id":"new"');
  });
});
