import { describe, expect, it } from "vitest";
import type { HostRecord } from "../types/host";
import {
  buildIdentityUsage,
  countHostsUsingIdentity,
  listHostsUsingIdentity,
} from "./identity-usage";

function makeHost(id: string, identityId?: string): HostRecord {
  return {
    id,
    label: id,
    protocol: "ssh",
    hostname: `${id}.example.com`,
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
    identityId,
  };
}

describe("buildIdentityUsage", () => {
  it("groups hosts by their identityId", () => {
    const hosts = [
      makeHost("h1", "id-a"),
      makeHost("h2", "id-a"),
      makeHost("h3", "id-b"),
    ];
    const usage = buildIdentityUsage(hosts);
    expect(usage.get("id-a")).toEqual(["h1", "h2"]);
    expect(usage.get("id-b")).toEqual(["h3"]);
    expect(usage.size).toBe(2);
  });

  it("excludes hosts without an identityId", () => {
    const hosts = [makeHost("h1"), makeHost("h2", "id-a")];
    const usage = buildIdentityUsage(hosts);
    expect(usage.size).toBe(1);
    expect(usage.get("id-a")).toEqual(["h2"]);
  });

  it("trims whitespace identityIds and treats them as missing", () => {
    const hosts = [makeHost("h1", "   ")];
    const usage = buildIdentityUsage(hosts);
    expect(usage.size).toBe(0);
  });

  it("returns an empty map for an empty hosts array", () => {
    expect(buildIdentityUsage([])).toEqual(new Map());
  });
});

describe("countHostsUsingIdentity", () => {
  const hosts = [
    makeHost("h1", "id-a"),
    makeHost("h2", "id-a"),
    makeHost("h3", "id-b"),
    makeHost("h4"),
  ];

  it("counts hosts by exact identityId match", () => {
    expect(countHostsUsingIdentity(hosts, "id-a")).toBe(2);
    expect(countHostsUsingIdentity(hosts, "id-b")).toBe(1);
    expect(countHostsUsingIdentity(hosts, "missing")).toBe(0);
  });

  it("returns 0 for an empty identityId", () => {
    expect(countHostsUsingIdentity(hosts, "")).toBe(0);
  });
});

describe("listHostsUsingIdentity", () => {
  const hosts = [
    makeHost("h1", "id-a"),
    makeHost("h2", "id-a"),
    makeHost("h3", "id-b"),
  ];

  it("returns the hosts whose identityId matches", () => {
    expect(listHostsUsingIdentity(hosts, "id-a").map((h) => h.id)).toEqual(["h1", "h2"]);
  });

  it("returns an empty array for an empty identityId", () => {
    expect(listHostsUsingIdentity(hosts, "")).toEqual([]);
  });

  it("returns an empty array when no hosts match", () => {
    expect(listHostsUsingIdentity(hosts, "missing")).toEqual([]);
  });
});
