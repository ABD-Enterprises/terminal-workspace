import { describe, expect, it } from "vitest";
import { sampleHosts } from "../types/host";
import { formatSessionConnectionState } from "../types/session";
import {
  appendPaneCommandHistoryOutput,
  cycleSessionTab,
  closeSessionTab,
  consumePaneCommand,
  duplicateSessionWorkspace,
  openSessionWorkspace,
  queuePaneCommand,
  recordPaneCommandHistory,
  removeSessionPane,
  sanitizePersistedCommandHistory,
  setTabSplitDirection,
  splitSessionPane,
  updatePaneConnectionState,
  updatePanePreviewPersistence,
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

  it("cycles through open tabs in both directions", () => {
    const initial = {
      tabs: [],
      panes: {},
      activeTabId: undefined,
      lastRestoredAt: undefined,
    };

    const first = openSessionWorkspace(initial, sampleHosts[0]);
    const second = duplicateSessionWorkspace(first, sampleHosts[1]);
    const third = duplicateSessionWorkspace(second, sampleHosts[2]);

    expect(third.activeTabId).toBe(third.tabs[2]?.id);

    const wrappedForward = cycleSessionTab(third, 1);
    expect(wrappedForward.activeTabId).toBe(third.tabs[0]?.id);

    const backward = cycleSessionTab(wrappedForward, -1);
    expect(backward.activeTabId).toBe(third.tabs[2]?.id);
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

  it("records executed pane commands in persisted history", () => {
    const opened = openSessionWorkspace(
      { tabs: [], panes: {}, activeTabId: undefined, lastRestoredAt: undefined },
      sampleHosts[0]
    );
    const paneId = opened.tabs[0]!.paneIds[0]!;

    const recorded = recordPaneCommandHistory(
      {
        ...opened,
        commandHistory: [],
      },
      paneId,
      "uptime",
      "queued"
    );

    expect(recorded.commandHistory).toHaveLength(1);
    expect(recorded.commandHistory[0]).toMatchObject({
      paneId,
      hostId: sampleHosts[0].id,
      transport: "ssh",
      command: "uptime",
      source: "queued",
    });
  });

  it("appends sanitized output previews to recorded history entries", () => {
    const opened = openSessionWorkspace(
      { tabs: [], panes: {}, activeTabId: undefined, lastRestoredAt: undefined },
      sampleHosts[0]
    );
    const paneId = opened.tabs[0]!.paneIds[0]!;
    const recorded = recordPaneCommandHistory(
      {
        ...opened,
        commandHistory: [],
      },
      paneId,
      "uptime",
      "queued"
    );
    const entryId = recorded.commandHistory[0]!.id;

    const updated = appendPaneCommandHistoryOutput(
      recorded,
      entryId,
      "\u001b[32mload average: 1.00\r\nusers: 2\u001b[0m"
    );
    const persisted = sanitizePersistedCommandHistory(updated.commandHistory, updated.panes);

    expect(updated.commandHistory[0]?.outputPreview).toBe("load average: 1.00\nusers: 2");
    expect(updated.commandHistory[0]?.outputUpdatedAt).toBeDefined();
    expect(persisted[0]?.outputPreview).toBe("load average: 1.00\nusers: 2");
  });

  it("redacts persisted output previews when a pane opts out", () => {
    const opened = openSessionWorkspace(
      { tabs: [], panes: {}, activeTabId: undefined, lastRestoredAt: undefined },
      sampleHosts[0]
    );
    const paneId = opened.tabs[0]!.paneIds[0]!;
    const recorded = recordPaneCommandHistory(
      {
        ...opened,
        commandHistory: [],
      },
      paneId,
      "uptime",
      "queued"
    );
    const entryId = recorded.commandHistory[0]!.id;
    const updated = appendPaneCommandHistoryOutput(recorded, entryId, "load average: 1.00");
    const optedOut = updatePanePreviewPersistence(updated, paneId, false);
    const persisted = sanitizePersistedCommandHistory(optedOut.commandHistory, optedOut.panes);

    expect(persisted[0]).toMatchObject({
      paneId,
      hostId: sampleHosts[0].id,
      transport: "ssh",
      command: "uptime",
      source: "queued",
    });
    expect(persisted[0]?.outputPreview).toBeUndefined();
    expect(persisted[0]?.outputUpdatedAt).toBeUndefined();
  });

  it("keeps opted-out command history redacted after the pane is removed", () => {
    const opened = openSessionWorkspace(
      { tabs: [], panes: {}, activeTabId: undefined, lastRestoredAt: undefined },
      sampleHosts[0]
    );
    const tabId = opened.tabs[0]!.id;
    const paneId = opened.tabs[0]!.paneIds[0]!;
    const recorded = recordPaneCommandHistory(
      {
        ...opened,
        commandHistory: [],
      },
      paneId,
      "uptime",
      "queued"
    );
    const entryId = recorded.commandHistory[0]!.id;
    const updated = appendPaneCommandHistoryOutput(recorded, entryId, "load average: 1.00");
    const optedOut = updatePanePreviewPersistence(updated, paneId, false);
    const closed = closeSessionTab(optedOut, tabId);
    const persisted = sanitizePersistedCommandHistory(
      optedOut.commandHistory,
      closed.panes
    );

    expect(closed.panes[paneId]).toBeUndefined();
    expect(persisted[0]).toMatchObject({
      paneId,
      persistOutputPreview: false,
    });
    expect(persisted[0]?.outputPreview).toBeUndefined();
    expect(persisted[0]?.outputUpdatedAt).toBeUndefined();
  });

  it("keeps opted-in command history previews after the pane is removed", () => {
    const opened = openSessionWorkspace(
      { tabs: [], panes: {}, activeTabId: undefined, lastRestoredAt: undefined },
      sampleHosts[0]
    );
    const tabId = opened.tabs[0]!.id;
    const paneId = opened.tabs[0]!.paneIds[0]!;
    const recorded = recordPaneCommandHistory(
      {
        ...opened,
        commandHistory: [],
      },
      paneId,
      "uptime",
      "queued"
    );
    const entryId = recorded.commandHistory[0]!.id;
    const updated = appendPaneCommandHistoryOutput(recorded, entryId, "load average: 1.00");
    const closed = closeSessionTab(updated, tabId);
    const persisted = sanitizePersistedCommandHistory(updated.commandHistory, closed.panes);

    expect(closed.panes[paneId]).toBeUndefined();
    expect(persisted[0]).toMatchObject({
      paneId,
      persistOutputPreview: true,
      outputPreview: "load average: 1.00",
    });
    expect(persisted[0]?.outputUpdatedAt).toBeDefined();
  });

  it("maps protocol-aware panes to their executable transports", () => {
    const telnetHost = {
      ...sampleHosts[0],
      id: "telnet-host",
      label: "Legacy Telnet",
      protocol: "telnet" as const,
      username: "",
      port: 23,
      authMethod: "none" as const,
    };
    const serialHost = {
      ...sampleHosts[0],
      id: "serial-host",
      label: "Serial Console",
      protocol: "serial" as const,
      hostname: "/dev/cu.usbserial-1410",
      username: "",
      port: 115200,
      authMethod: "none" as const,
    };
    const moshHost = {
      ...sampleHosts[0],
      id: "mosh-host",
      label: "Ops Mosh",
      protocol: "mosh" as const,
      authMethod: "none" as const,
    };

    const telnetWorkspace = openSessionWorkspace(
      { tabs: [], panes: {}, activeTabId: undefined, lastRestoredAt: undefined },
      telnetHost
    );
    const serialWorkspace = openSessionWorkspace(
      { tabs: [], panes: {}, activeTabId: undefined, lastRestoredAt: undefined },
      serialHost
    );
    const moshWorkspace = openSessionWorkspace(
      { tabs: [], panes: {}, activeTabId: undefined, lastRestoredAt: undefined },
      moshHost
    );

    expect(telnetWorkspace.panes[telnetWorkspace.tabs[0]!.paneIds[0]!]!.transport).toBe("telnet");
    expect(serialWorkspace.panes[serialWorkspace.tabs[0]!.paneIds[0]!]!.transport).toBe("serial");
    expect(moshWorkspace.panes[moshWorkspace.tabs[0]!.paneIds[0]!]!.transport).toBe("mosh");
  });
});
