import { describe, expect, it } from "vitest";
import { sampleHosts } from "../types/host";
import { formatSessionConnectionState } from "../types/session";
import {
  closeSessionTab,
  consumePaneCommand,
  duplicateSessionWorkspace,
  openSessionWorkspace,
  queuePaneCommand,
  removeSessionPane,
  setTabSplitDirection,
  splitSessionPane,
  updatePaneConnectionState,
  updatePaneReconnectPreference,
} from "./sessions-store";

describe("sessions store helpers", () => {
  it("opens a session and focuses an existing tab for the same host", () => {
    const initial = {
      tabs: [],
      panes: {},
      activeTabId: undefined,
      lastRestoredAt: undefined,
    };

    const opened = openSessionWorkspace(initial, sampleHosts[0]);
    expect(opened.tabs).toHaveLength(1);
    expect(opened.activeTabId).toBe(opened.tabs[0]?.id);

    const openedAgain = openSessionWorkspace(opened, sampleHosts[0]);
    expect(openedAgain.tabs).toHaveLength(1);
    expect(openedAgain.activeTabId).toBe(opened.tabs[0]?.id);
  });

  it("duplicates a session into a new tab with a distinct title", () => {
    const initial = {
      tabs: [],
      panes: {},
      activeTabId: undefined,
      lastRestoredAt: undefined,
    };

    const opened = openSessionWorkspace(initial, sampleHosts[0]);
    const duplicated = duplicateSessionWorkspace(opened, sampleHosts[0]);

    expect(duplicated.tabs).toHaveLength(2);
    expect(duplicated.activeTabId).toBe(duplicated.tabs[1]?.id);
    expect(duplicated.tabs[1]?.title).toBe(`${sampleHosts[0].label} (2)`);
  });

  it("splits and removes panes inside a tab", () => {
    const opened = openSessionWorkspace(
      { tabs: [], panes: {}, activeTabId: undefined, lastRestoredAt: undefined },
      sampleHosts[0]
    );
    const tabId = opened.tabs[0]!.id;

    const split = splitSessionPane(opened, tabId, sampleHosts[0]);
    expect(split.tabs[0]?.paneIds).toHaveLength(2);

    const secondPaneId = split.tabs[0]!.paneIds[1]!;
    const afterRemoval = removeSessionPane(split, tabId, secondPaneId);
    expect(afterRemoval.tabs[0]?.paneIds).toHaveLength(1);
  });

  it("updates connection state and closes tabs", () => {
    const opened = openSessionWorkspace(
      { tabs: [], panes: {}, activeTabId: undefined, lastRestoredAt: undefined },
      sampleHosts[1]
    );
    const paneId = opened.tabs[0]!.paneIds[0]!;

    const connected = updatePaneConnectionState(opened, paneId, "connected");
    expect(connected.panes[paneId]?.connectionState).toBe("connected");
    expect(connected.panes[paneId]?.reconnectOnRestore).toBe(true);

    const horizontal = setTabSplitDirection(connected, connected.tabs[0]!.id, "horizontal");
    expect(horizontal.tabs[0]?.splitDirection).toBe("horizontal");

    const closed = closeSessionTab(horizontal, horizontal.tabs[0]!.id);
    expect(closed.tabs).toHaveLength(0);
    expect(Object.keys(closed.panes)).toHaveLength(0);
  });

  it("preserves reconnect intent until the user explicitly clears it", () => {
    const opened = openSessionWorkspace(
      { tabs: [], panes: {}, activeTabId: undefined, lastRestoredAt: undefined },
      sampleHosts[1]
    );
    const paneId = opened.tabs[0]!.paneIds[0]!;

    const connected = updatePaneConnectionState(opened, paneId, "connected");
    const errored = updatePaneConnectionState(connected, paneId, "error");
    expect(errored.panes[paneId]?.reconnectOnRestore).toBe(true);

    const cleared = updatePaneReconnectPreference(errored, paneId, false);
    const disconnected = updatePaneConnectionState(cleared, paneId, "disconnected");
    expect(disconnected.panes[paneId]?.reconnectOnRestore).toBe(false);
  });

  it("keeps reconnect intent when a restored pane is waiting on runtime secrets", () => {
    const opened = openSessionWorkspace(
      { tabs: [], panes: {}, activeTabId: undefined, lastRestoredAt: undefined },
      sampleHosts[1]
    );
    const paneId = opened.tabs[0]!.paneIds[0]!;

    const connected = updatePaneConnectionState(opened, paneId, "connected");
    const waiting = updatePaneConnectionState(connected, paneId, "pendingSecrets");

    expect(waiting.panes[paneId]?.connectionState).toBe("pendingSecrets");
    expect(waiting.panes[paneId]?.reconnectOnRestore).toBe(true);
    expect(formatSessionConnectionState("pendingSecrets")).toBe("needs secrets");
  });

  it("queues and consumes pane commands", () => {
    const opened = openSessionWorkspace(
      { tabs: [], panes: {}, activeTabId: undefined, lastRestoredAt: undefined },
      sampleHosts[0]
    );
    const paneId = opened.tabs[0]!.paneIds[0]!;

    const queued = queuePaneCommand(opened, paneId, "uptime", "Check uptime");
    expect(queued.panes[paneId]?.queuedCommands).toHaveLength(1);
    expect(queued.panes[paneId]?.queuedCommands[0]?.command).toBe("uptime");

    const consumed = consumePaneCommand(queued, paneId, queued.panes[paneId]!.queuedCommands[0]!.id);
    expect(consumed.panes[paneId]?.queuedCommands).toHaveLength(0);
  });
});
