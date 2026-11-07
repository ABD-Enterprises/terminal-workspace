import { beforeEach, describe, expect, it, vi } from "vitest";
import type { VaultDeletionMap } from "../store/vault-sync-store";

// #472: native persistence goes through typed commands. This fake stands in
// for src-tauri/src/persistence.rs, whose own tests cover the SQL against a
// real database; here the renderer side's fallbacks and mirroring are tested.

interface NativeOptions {
  failReads?: boolean;
  failCommand?: string;
}

interface DeletionRecord {
  deletedAt: string;
  id: string;
  kind: string;
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

class FakeNative {
  readonly calls: string[] = [];
  readonly deletions = new Map<string, DeletionRecord>();
  readonly stores = new Map<string, string>();

  constructor(private readonly options: NativeOptions = {}) {}

  async invoke(command: string, args?: { request: Record<string, unknown> }) {
    this.calls.push(command);
    const request = args?.request ?? {};
    if (this.options.failCommand === command) {
      throw new Error(`${command} failed`);
    }
    switch (command) {
      case "terminal_workspace_persistence_read_store":
        if (this.options.failReads) {
          throw new Error("read failed");
        }
        return this.stores.get(String(request.store)) ?? null;
      case "terminal_workspace_persistence_write_store":
        this.stores.set(String(request.store), String(request.payload));
        return undefined;
      case "terminal_workspace_persistence_remove_store":
        this.stores.delete(String(request.store));
        return undefined;
      case "terminal_workspace_persistence_read_deletions":
        if (this.options.failReads) {
          throw new Error("read failed");
        }
        return [...this.deletions.values()].sort((left, right) =>
          right.deletedAt.localeCompare(left.deletedAt)
        );
      case "terminal_workspace_persistence_replace_deletions":
        this.deletions.clear();
        for (const record of request.records as DeletionRecord[]) {
          this.deletions.set(`${record.kind}:${record.id}`, record);
        }
        return undefined;
      case "terminal_workspace_persistence_clear_deletions":
        this.deletions.clear();
        return undefined;
      default:
        throw new Error(`unexpected command ${command}`);
    }
  }
}

function serializeDeletions(deletions: Partial<VaultDeletionMap>) {
  return JSON.stringify({
    state: { deletions },
    version: 1,
  });
}

async function loadPersistence(native: FakeNative) {
  const localStorage = new MemoryStorage();
  vi.stubGlobal("window", { localStorage });
  vi.doMock("./backend-runtime", () => ({
    isTauriRuntime: () => true,
    invokeTauriCommand: (command: string, args?: { request: Record<string, unknown> }) =>
      native.invoke(command, args),
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
    const native = new FakeNative();
    const { localStorage, persistence } = await loadPersistence(native);
    const storage = persistence.createTermsnipStorage("terminal-workspace-hosts");
    localStorage.setItem("terminal-workspace-hosts", "local-payload");

    await expect(storage.getItem("terminal-workspace-hosts")).resolves.toBe("local-payload");
    expect(native.stores.get("terminal-workspace-hosts")).toBe("local-payload");

    await storage.setItem("terminal-workspace-hosts", "sqlite-payload");
    expect(native.stores.get("terminal-workspace-hosts")).toBe("sqlite-payload");
    expect(localStorage.getItem("terminal-workspace-hosts")).toBe("sqlite-payload");

    await storage.removeItem("terminal-workspace-hosts");
    expect(native.stores.has("terminal-workspace-hosts")).toBe(false);
    expect(localStorage.getItem("terminal-workspace-hosts")).toBeNull();
  });

  it("reads the native payload in preference to localStorage", async () => {
    const native = new FakeNative();
    native.stores.set("terminal-workspace-keys", "native-payload");
    const { localStorage, persistence } = await loadPersistence(native);
    localStorage.setItem("terminal-workspace-keys", "stale-local");

    await expect(
      persistence.createTermsnipStorage("terminal-workspace-keys").getItem("terminal-workspace-keys")
    ).resolves.toBe("native-payload");
    expect(native.calls).not.toContain("terminal_workspace_persistence_write_store");
  });

  it("#115: forward-migrates a legacy termsnip-* key, keeping the old key for rollback", async () => {
    const { localStorage, persistence } = await loadPersistence(new FakeNative());
    // Data exists only under the legacy namespace; the new key is absent.
    localStorage.setItem("termsnip-app", "legacy-payload");
    const storage = persistence.createMigratingLocalStorage();

    // Reading the new key returns the legacy value, copies it forward, and
    // leaves the legacy key in place so a rollback still finds the data.
    expect(storage.getItem("terminal-workspace-app")).toBe("legacy-payload");
    expect(localStorage.getItem("terminal-workspace-app")).toBe("legacy-payload");
    expect(localStorage.getItem("termsnip-app")).toBe("legacy-payload");
  });

  it("falls back to localStorage when a native READ fails", async () => {
    const harness = await loadPersistence(new FakeNative({ failReads: true }));
    harness.localStorage.setItem("terminal-workspace-hosts", "fallback-payload");
    await expect(
      harness.persistence
        .createTermsnipStorage("terminal-workspace-hosts")
        .getItem("terminal-workspace-hosts")
    ).resolves.toBe("fallback-payload");

    harness.localStorage.setItem("terminal-workspace-vault-sync", "deletion-fallback");
    await expect(
      harness.persistence
        .createTermsnipDeletionStorage("terminal-workspace-vault-sync")
        .getItem("terminal-workspace-vault-sync")
    ).resolves.toBe("deletion-fallback");
  });

  it("#146: a native write failure rejects and does NOT shadow-write localStorage", async () => {
    const harness = await loadPersistence(
      new FakeNative({ failCommand: "terminal_workspace_persistence_write_store" })
    );
    const storage = harness.persistence.createTermsnipStorage("terminal-workspace-hosts");
    // localStorage already mirrors the last good SQLite value.
    harness.localStorage.setItem("terminal-workspace-hosts", "old-value");

    await expect(storage.setItem("terminal-workspace-hosts", "new-value")).rejects.toThrow(
      /write_store failed/
    );

    // The failed write must NOT leave a localStorage copy newer than SQLite —
    // that split-brain is exactly what later resurrects the stale SQLite row.
    expect(harness.localStorage.getItem("terminal-workspace-hosts")).toBe("old-value");
  });

  it("#146: a native delete failure rejects and does NOT shadow-remove localStorage", async () => {
    const harness = await loadPersistence(
      new FakeNative({ failCommand: "terminal_workspace_persistence_remove_store" })
    );
    const storage = harness.persistence.createTermsnipStorage("terminal-workspace-hosts");
    harness.localStorage.setItem("terminal-workspace-hosts", "still-here");

    await expect(storage.removeItem("terminal-workspace-hosts")).rejects.toThrow(
      /remove_store failed/
    );
    expect(harness.localStorage.getItem("terminal-workspace-hosts")).toBe("still-here");
  });

  it("sends every deletion kind in one replace and mirrors it to localStorage", async () => {
    const native = new FakeNative();
    const { localStorage, persistence } = await loadPersistence(native);
    const storage = persistence.createTermsnipDeletionStorage("terminal-workspace-vault-sync");

    await storage.setItem(
      "terminal-workspace-vault-sync",
      serializeDeletions({
        hosts: [{ deletedAt: "2026-02-01T00:00:00.000Z", id: "new" }],
        knownHosts: [{ deletedAt: "2026-02-02T00:00:00.000Z", id: "kh" }],
      })
    );

    expect(
      native.calls.filter((call) => call === "terminal_workspace_persistence_replace_deletions")
    ).toHaveLength(1);
    expect(native.deletions.get("hosts:new")).toEqual({
      kind: "hosts",
      id: "new",
      deletedAt: "2026-02-01T00:00:00.000Z",
    });
    expect(native.deletions.get("knownHosts:kh")).toBeDefined();
    expect(localStorage.getItem("terminal-workspace-vault-sync")).toContain('"id":"new"');

    await expect(storage.getItem("terminal-workspace-vault-sync")).resolves.toBe(
      serializeDeletions({
        hosts: [{ deletedAt: "2026-02-01T00:00:00.000Z", id: "new" }],
        keys: [],
        snippets: [],
        knownHosts: [{ deletedAt: "2026-02-02T00:00:00.000Z", id: "kh" }],
        identities: [],
      })
    );
  });

  it("#146: a failed deletion replace rejects and does NOT shadow-write localStorage", async () => {
    const native = new FakeNative({
      failCommand: "terminal_workspace_persistence_replace_deletions",
    });
    native.deletions.set("hosts:old", {
      deletedAt: "2026-01-01T00:00:00.000Z",
      id: "old",
      kind: "hosts",
    });
    const { localStorage, persistence } = await loadPersistence(native);
    const storage = persistence.createTermsnipDeletionStorage("terminal-workspace-vault-sync");

    await expect(
      storage.setItem(
        "terminal-workspace-vault-sync",
        serializeDeletions({
          hosts: [{ deletedAt: "2026-02-01T00:00:00.000Z", id: "new" }],
        })
      )
    ).rejects.toThrow(/replace_deletions failed/);

    expect(native.deletions.get("hosts:old")).toBeDefined();
    expect(localStorage.getItem("terminal-workspace-vault-sync")).toBeNull();
  });

  it("clears deletions natively and in localStorage", async () => {
    const native = new FakeNative();
    native.deletions.set("hosts:a", { deletedAt: "2026-01-01T00:00:00.000Z", id: "a", kind: "hosts" });
    const { localStorage, persistence } = await loadPersistence(native);
    localStorage.setItem("terminal-workspace-vault-sync", "x");

    await persistence
      .createTermsnipDeletionStorage("terminal-workspace-vault-sync")
      .removeItem("terminal-workspace-vault-sync");
    expect(native.deletions.size).toBe(0);
    expect(localStorage.getItem("terminal-workspace-vault-sync")).toBeNull();
  });
});
