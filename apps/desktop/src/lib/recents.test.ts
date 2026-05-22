import { describe, expect, it } from "vitest";
import type { HostRecord } from "../types/host";
import type { SnippetRecord } from "../types/snippet";
import {
  selectMostRecentlyConnectedHosts,
  selectMostRecentlyRunSnippets,
} from "./recents";

function host(id: string, lastConnectedAt?: string): HostRecord {
  return {
    id,
    label: id,
    protocol: "ssh",
    hostname: "h",
    username: "u",
    port: 22,
    authMethod: "none",
    privateKeyPath: "",
    group: "",
    tags: [],
    note: "",
    favorite: false,
    keyLabel: "",
    hostKeyPolicy: "requireTrusted",
    agentForwarding: false,
    environment: {},
    jumpHostId: undefined,
    sftpRoot: "",
    snippetCount: 0,
    forwardingCount: 0,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    lastConnectedAt,
  };
}

function snippet(id: string, lastRunAt?: string): SnippetRecord {
  return {
    id,
    title: id,
    description: "",
    command: "true",
    tags: [],
    targetHostIds: [],
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    lastRunAt,
  };
}

describe("selectMostRecentlyConnectedHosts", () => {
  it("filters out hosts without lastConnectedAt", () => {
    const result = selectMostRecentlyConnectedHosts(
      [host("a", "2026-05-01"), host("b"), host("c", "2026-05-02")],
      10
    );
    expect(result.map((h) => h.id)).toEqual(["c", "a"]);
  });

  it("returns an empty array when no host has lastConnectedAt", () => {
    expect(selectMostRecentlyConnectedHosts([host("a"), host("b")], 5)).toEqual([]);
  });

  it("respects the limit", () => {
    const result = selectMostRecentlyConnectedHosts(
      [
        host("a", "2026-05-01"),
        host("b", "2026-05-02"),
        host("c", "2026-05-03"),
      ],
      2
    );
    expect(result.map((h) => h.id)).toEqual(["c", "b"]);
  });

  it("does not mutate the input array", () => {
    const input = [host("a", "2026-05-01"), host("b", "2026-05-02")];
    const inputIds = input.map((h) => h.id);
    selectMostRecentlyConnectedHosts(input, 10);
    expect(input.map((h) => h.id)).toEqual(inputIds);
  });
});

describe("selectMostRecentlyRunSnippets", () => {
  it("filters out snippets without lastRunAt and sorts desc", () => {
    const result = selectMostRecentlyRunSnippets(
      [
        snippet("a", "2026-05-01"),
        snippet("b"),
        snippet("c", "2026-05-03"),
        snippet("d", "2026-05-02"),
      ],
      10
    );
    expect(result.map((s) => s.id)).toEqual(["c", "d", "a"]);
  });
});
