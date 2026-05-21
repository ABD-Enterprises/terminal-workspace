import { describe, expect, it } from "vitest";
import type { SessionPane } from "../types/session";
import { deriveHostConnectionStatus } from "./host-status";

function pane(hostId: string, state: SessionPane["connectionState"]): SessionPane {
  return {
    id: `pane-${hostId}-${state}`,
    hostId,
    title: `${hostId} (${state})`,
    connectionState: state,
    transport: "mock",
    queuedCommands: [],
    reconnectOnRestore: false,
    persistOutputPreview: false,
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-01T00:00:00.000Z",
  };
}

describe("deriveHostConnectionStatus", () => {
  it("returns idle when no pane references the host", () => {
    const panes = {
      [pane("other", "connected").id]: pane("other", "connected"),
    };
    expect(deriveHostConnectionStatus("h1", panes)).toBe("idle");
  });

  it("returns idle for an empty pane map", () => {
    expect(deriveHostConnectionStatus("h1", {})).toBe("idle");
  });

  it("returns connected when at least one matching pane is connected", () => {
    const p1 = pane("h1", "connected");
    const panes = { [p1.id]: p1 };
    expect(deriveHostConnectionStatus("h1", panes)).toBe("connected");
  });

  it("returns connecting when only connecting/pendingSecrets panes match", () => {
    const p1 = pane("h1", "connecting");
    const p2 = pane("h1", "pendingSecrets");
    const panes = { [p1.id]: p1, [p2.id]: p2 };
    expect(deriveHostConnectionStatus("h1", panes)).toBe("connecting");
  });

  it("connected wins over connecting (a session in progress shows connected)", () => {
    const p1 = pane("h1", "connecting");
    const p2 = pane("h1", "connected");
    const panes = { [p1.id]: p1, [p2.id]: p2 };
    expect(deriveHostConnectionStatus("h1", panes)).toBe("connected");
  });

  it("disconnected and error are treated as idle for the dot", () => {
    const p1 = pane("h1", "disconnected");
    const p2 = pane("h1", "error");
    const panes = { [p1.id]: p1, [p2.id]: p2 };
    expect(deriveHostConnectionStatus("h1", panes)).toBe("idle");
  });

  it("only counts panes whose hostId matches", () => {
    const p1 = pane("other", "connected");
    const p2 = pane("h1", "connecting");
    const panes = { [p1.id]: p1, [p2.id]: p2 };
    expect(deriveHostConnectionStatus("h1", panes)).toBe("connecting");
  });
});
