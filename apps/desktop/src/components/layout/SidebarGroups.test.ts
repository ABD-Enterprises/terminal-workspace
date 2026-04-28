import { describe, expect, it } from "vitest";
import type { HostRecord } from "../../types/host";
import { __testing } from "./SidebarGroups";

const { deriveGroups, UNGROUPED_KEY } = __testing;

function makeHost(id: string, group: string | undefined = ""): HostRecord {
  return {
    id,
    label: id,
    protocol: "ssh",
    hostname: `${id}.example.com`,
    username: "deploy",
    port: 22,
    authMethod: "privateKey",
    privateKeyPath: "~/.ssh/id_ed25519",
    group: group ?? "",
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
  };
}

describe("SidebarGroups deriveGroups", () => {
  it("returns an empty list for an empty hosts array", () => {
    expect(deriveGroups([])).toEqual([]);
  });

  it("buckets hosts into named groups by host.group", () => {
    const hosts = [makeHost("h1", "Production"), makeHost("h2", "Production"), makeHost("h3", "Staging")];
    const groups = deriveGroups(hosts);
    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({ name: "Production", hostIds: ["h1", "h2"] });
    expect(groups[1]).toMatchObject({ name: "Staging", hostIds: ["h3"] });
  });

  it("sorts named groups alphabetically and pins Ungrouped last", () => {
    const hosts = [
      makeHost("h1", "Zoo"),
      makeHost("h2", ""),
      makeHost("h3", "Apple"),
      makeHost("h4", undefined),
    ];
    const groups = deriveGroups(hosts);
    expect(groups.map((group) => group.name)).toEqual(["Apple", "Zoo", UNGROUPED_KEY]);
    const ungrouped = groups.find((group) => group.name === UNGROUPED_KEY);
    expect(ungrouped?.hostIds).toEqual(["h2", "h4"]);
  });

  it("treats whitespace-only group strings as Ungrouped", () => {
    const hosts = [makeHost("h1", "   "), makeHost("h2", "Real")];
    const groups = deriveGroups(hosts);
    const names = groups.map((group) => group.name);
    expect(names).toEqual(["Real", UNGROUPED_KEY]);
    expect(groups.find((g) => g.name === UNGROUPED_KEY)?.hostIds).toEqual(["h1"]);
  });

  it("does not include an Ungrouped bucket when every host has a group", () => {
    const hosts = [makeHost("h1", "A"), makeHost("h2", "B")];
    const groups = deriveGroups(hosts);
    expect(groups.map((group) => group.name)).toEqual(["A", "B"]);
  });
});
