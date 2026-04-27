import { describe, expect, it } from "vitest";
import { applyIdentityAssignments, migrateHostsToIdentities } from "./identity-migration";
import type { HostRecord } from "../types/host";
import type { IdentityRecord } from "../types/identity";
import type { KeyRecord } from "../types/key";

function makeHost(overrides: Partial<HostRecord>): HostRecord {
  return {
    id: "h1",
    label: "Host 1",
    protocol: "ssh",
    hostname: "h1.example.com",
    username: "deploy",
    port: 22,
    authMethod: "privateKey",
    privateKeyPath: "~/.ssh/id_ed25519",
    group: "",
    tags: [],
    note: "",
    favorite: false,
    keyLabel: "",
    hostKeyPolicy: "requireTrusted",
    agentForwarding: false,
    environment: {},
    sftpRoot: "",
    snippetCount: 0,
    forwardingCount: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeKey(overrides: Partial<KeyRecord>): KeyRecord {
  return {
    id: "k1",
    label: "Key 1",
    algorithm: "ED25519",
    bits: 256,
    fingerprint: "SHA256:demo",
    comment: "",
    privateKeyPath: "~/.ssh/id_ed25519",
    source: "imported",
    hasPassphrase: false,
    assignedHostIds: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeIdGenerator() {
  let counter = 0;
  return () => `identity-${++counter}`;
}

const FIXED_NOW = "2026-04-27T00:00:00.000Z";

describe("migrateHostsToIdentities", () => {
  it("returns empty results when there are no hosts", () => {
    const result = migrateHostsToIdentities({
      hosts: [],
      keys: [],
      existingIdentities: [],
      generateId: makeIdGenerator(),
      now: () => FIXED_NOW,
    });
    expect(result.identitiesToAdd).toEqual([]);
    expect(result.assignmentsByHostId).toEqual({});
    expect(result.orphanedIdentityIds).toEqual([]);
  });

  it("derives one identity per (authMethod, username, privateKeyPath) tuple", () => {
    const result = migrateHostsToIdentities({
      hosts: [makeHost({ id: "h1" })],
      keys: [],
      existingIdentities: [],
      generateId: makeIdGenerator(),
      now: () => FIXED_NOW,
    });
    expect(result.identitiesToAdd).toHaveLength(1);
    expect(result.identitiesToAdd[0]).toMatchObject({
      id: "identity-1",
      username: "deploy",
      authMethod: "privateKey",
      privateKeyPath: "~/.ssh/id_ed25519",
      source: "derived",
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW,
    });
    expect(result.assignmentsByHostId).toEqual({ h1: "identity-1" });
  });

  it("dedupes two hosts that share a (username, key path) tuple to one identity", () => {
    const result = migrateHostsToIdentities({
      hosts: [
        makeHost({ id: "h1" }),
        makeHost({ id: "h2", hostname: "h2.example.com", label: "Host 2" }),
      ],
      keys: [],
      existingIdentities: [],
      generateId: makeIdGenerator(),
      now: () => FIXED_NOW,
    });
    expect(result.identitiesToAdd).toHaveLength(1);
    expect(result.assignmentsByHostId).toEqual({
      h1: "identity-1",
      h2: "identity-1",
    });
  });

  it("creates separate identities when usernames differ", () => {
    const result = migrateHostsToIdentities({
      hosts: [
        makeHost({ id: "h1", username: "alice" }),
        makeHost({ id: "h2", username: "bob" }),
      ],
      keys: [],
      existingIdentities: [],
      generateId: makeIdGenerator(),
      now: () => FIXED_NOW,
    });
    expect(result.identitiesToAdd).toHaveLength(2);
    expect(result.assignmentsByHostId.h1).not.toBe(result.assignmentsByHostId.h2);
  });

  it("creates separate identities when authMethod differs", () => {
    const result = migrateHostsToIdentities({
      hosts: [
        makeHost({ id: "h1", authMethod: "privateKey" }),
        makeHost({ id: "h2", authMethod: "password", privateKeyPath: "" }),
      ],
      keys: [],
      existingIdentities: [],
      generateId: makeIdGenerator(),
      now: () => FIXED_NOW,
    });
    expect(result.identitiesToAdd).toHaveLength(2);
    expect(result.identitiesToAdd.map((entry) => entry.authMethod).sort()).toEqual([
      "password",
      "privateKey",
    ]);
  });

  it("skips hosts whose authMethod is 'none' (local shells, etc.)", () => {
    const result = migrateHostsToIdentities({
      hosts: [makeHost({ id: "local", authMethod: "none", privateKeyPath: "" })],
      keys: [],
      existingIdentities: [],
      generateId: makeIdGenerator(),
      now: () => FIXED_NOW,
    });
    expect(result.identitiesToAdd).toEqual([]);
    expect(result.assignmentsByHostId).toEqual({});
  });

  it("skips privateKey hosts with an empty privateKeyPath (degenerate input)", () => {
    const result = migrateHostsToIdentities({
      hosts: [makeHost({ id: "h1", authMethod: "privateKey", privateKeyPath: "" })],
      keys: [],
      existingIdentities: [],
      generateId: makeIdGenerator(),
      now: () => FIXED_NOW,
    });
    expect(result.identitiesToAdd).toEqual([]);
  });

  it("populates keyId and hasPassphrase from a matching KeyRecord", () => {
    const result = migrateHostsToIdentities({
      hosts: [makeHost({ id: "h1", privateKeyPath: "~/.ssh/deploy" })],
      keys: [
        makeKey({
          id: "k-deploy",
          privateKeyPath: "~/.ssh/deploy",
          hasPassphrase: true,
        }),
      ],
      existingIdentities: [],
      generateId: makeIdGenerator(),
      now: () => FIXED_NOW,
    });
    expect(result.identitiesToAdd[0]).toMatchObject({
      keyId: "k-deploy",
      hasPassphrase: true,
    });
  });

  it("re-uses an existing identity that matches by equivalence key (idempotent)", () => {
    const existing: IdentityRecord = {
      id: "identity-prior",
      label: "Pre-existing",
      username: "deploy",
      authMethod: "privateKey",
      privateKeyPath: "~/.ssh/id_ed25519",
      hasPassphrase: false,
      comment: "",
      source: "imported",
      createdAt: "2025-12-01T00:00:00.000Z",
      updatedAt: "2025-12-01T00:00:00.000Z",
    };
    const result = migrateHostsToIdentities({
      hosts: [makeHost({ id: "h1" })],
      keys: [],
      existingIdentities: [existing],
      generateId: makeIdGenerator(),
      now: () => FIXED_NOW,
    });
    expect(result.identitiesToAdd).toEqual([]);
    expect(result.assignmentsByHostId).toEqual({ h1: "identity-prior" });
    expect(result.orphanedIdentityIds).toEqual([]);
  });

  it("respects an existing identityId already on a host (no re-resolve when valid)", () => {
    const existing: IdentityRecord = {
      id: "identity-explicit",
      label: "Explicit pre-set",
      username: "elsewhere",
      authMethod: "password",
      privateKeyPath: "",
      hasPassphrase: false,
      comment: "",
      source: "imported",
      createdAt: "2025-11-01T00:00:00.000Z",
      updatedAt: "2025-11-01T00:00:00.000Z",
    };
    const result = migrateHostsToIdentities({
      hosts: [makeHost({ id: "h1", identityId: "identity-explicit" })],
      keys: [],
      existingIdentities: [existing],
      generateId: makeIdGenerator(),
      now: () => FIXED_NOW,
    });
    expect(result.identitiesToAdd).toEqual([]);
    expect(result.assignmentsByHostId).toEqual({ h1: "identity-explicit" });
  });

  it("heals a stale identityId pointing at a missing identity by re-resolving", () => {
    const result = migrateHostsToIdentities({
      hosts: [makeHost({ id: "h1", identityId: "identity-deleted" })],
      keys: [],
      existingIdentities: [],
      generateId: makeIdGenerator(),
      now: () => FIXED_NOW,
    });
    expect(result.identitiesToAdd).toHaveLength(1);
    expect(result.assignmentsByHostId.h1).toBe("identity-1");
  });

  it("reports identities no host references as orphans (not deleted)", () => {
    const orphan: IdentityRecord = {
      id: "identity-orphan",
      label: "Orphan",
      username: "ghost",
      authMethod: "password",
      privateKeyPath: "",
      hasPassphrase: false,
      comment: "",
      source: "imported",
      createdAt: "2025-10-01T00:00:00.000Z",
      updatedAt: "2025-10-01T00:00:00.000Z",
    };
    const result = migrateHostsToIdentities({
      hosts: [makeHost({ id: "h1" })],
      keys: [],
      existingIdentities: [orphan],
      generateId: makeIdGenerator(),
      now: () => FIXED_NOW,
    });
    expect(result.orphanedIdentityIds).toEqual(["identity-orphan"]);
  });
});

describe("applyIdentityAssignments", () => {
  it("returns the same array reference when no host needs an update", () => {
    const hosts = [makeHost({ id: "h1", identityId: "x" })];
    const next = applyIdentityAssignments(hosts, { h1: "x" });
    expect(next).toBe(hosts);
  });

  it("returns a new array with identityId stamped where missing", () => {
    const hosts = [makeHost({ id: "h1" })];
    const next = applyIdentityAssignments(hosts, { h1: "identity-1" });
    expect(next).not.toBe(hosts);
    expect(next[0].identityId).toBe("identity-1");
  });

  it("updates only hosts whose identityId differs", () => {
    const hosts = [
      makeHost({ id: "h1", identityId: "old" }),
      makeHost({ id: "h2", identityId: "stable" }),
    ];
    const next = applyIdentityAssignments(hosts, { h1: "new", h2: "stable" });
    expect(next[0].identityId).toBe("new");
    expect(next[1]).toBe(hosts[1]);
  });

  it("ignores host ids that are not in the assignments map", () => {
    const hosts = [makeHost({ id: "h1" })];
    const next = applyIdentityAssignments(hosts, {});
    expect(next).toBe(hosts);
  });
});
