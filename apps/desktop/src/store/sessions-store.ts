import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";
import type { HostRecord } from "../types/host";
import {
  createSessionPane,
  createSessionTab,
  type SessionCommandHistoryEntry,
  type SessionCommandHistorySource,
  type QueuedPaneCommand,
  type SessionConnectionState,
  type SessionPane,
  type SessionTransport,
  type SessionTab,
  type SessionWorkspaceState,
  type SplitDirection,
} from "../types/session";

const fallbackStorage: StateStorage = {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
};

const SESSION_HISTORY_LIMIT = 200;
const SESSION_HISTORY_OUTPUT_LIMIT = 600;
const ANSI_ESCAPE_CHARACTER = String.fromCharCode(27);
const TERMINAL_BELL_CHARACTER = String.fromCharCode(7);
const ANSI_ESCAPE_SEQUENCE_REGEX = new RegExp(
  `${ANSI_ESCAPE_CHARACTER}\\[[0-9;?]*[ -/]*[@-~]`,
  "g"
);
const TERMINAL_BELL_REGEX = new RegExp(TERMINAL_BELL_CHARACTER, "g");

function limitCommandHistory(commandHistory: SessionCommandHistoryEntry[]) {
  return commandHistory.slice(0, SESSION_HISTORY_LIMIT);
}

function normalizePersistedPane(pane: SessionPane): SessionPane {
  return {
    ...pane,
    persistOutputPreview: pane.persistOutputPreview ?? true,
  };
}

function resolvePersistOutputPreview(
  entry: SessionCommandHistoryEntry,
  panes: Record<string, SessionPane>
) {
  const pane = panes[entry.paneId];
  return pane
    ? normalizePersistedPane(pane).persistOutputPreview
    : entry.persistOutputPreview ?? false;
}

function sanitizePersistedWorkspace(
  workspace: Pick<SessionWorkspaceState, "tabs" | "panes" | "activeTabId" | "lastRestoredAt">
) {
  return {
    ...workspace,
    panes: Object.fromEntries(
      Object.entries(workspace.panes).map(([paneId, pane]) => {
        const normalizedPane = normalizePersistedPane(pane);

        return [
          paneId,
          {
            ...normalizedPane,
            backendSessionId: undefined,
            connectionState: "disconnected" as const,
            queuedCommands: [],
            reconnectOnRestore:
              normalizedPane.connectionState === "connected" || normalizedPane.reconnectOnRestore,
          },
        ];
      })
    ),
  };
}

export function sanitizePersistedCommandHistory(
  commandHistory: SessionCommandHistoryEntry[],
  panes: Record<string, SessionPane>
) {
  return limitCommandHistory(commandHistory).map<SessionCommandHistoryEntry>((entry) => {
    const persistOutputPreview = resolvePersistOutputPreview(entry, panes);
    if (persistOutputPreview) {
      return {
        ...entry,
        persistOutputPreview: true,
      };
    }

    return {
      ...entry,
      persistOutputPreview: false,
      outputPreview: undefined,
      outputUpdatedAt: undefined,
    };
  });
}

function normalizeCommandHistoryOutput(output: string) {
  return output
    .replace(ANSI_ESCAPE_SEQUENCE_REGEX, "")
    .replace(/\r/g, "")
    .replace(TERMINAL_BELL_REGEX, "")
    .trim();
}

function touchTab(tab: SessionTab, update?: Partial<SessionTab>): SessionTab {
  return {
    ...tab,
    ...update,
    updatedAt: new Date().toISOString(),
  };
}

function touchPane(pane: SessionPane, update?: Partial<SessionPane>): SessionPane {
  return {
    ...pane,
    ...update,
    updatedAt: new Date().toISOString(),
  };
}

function queueCommand(
  pane: SessionPane,
  command: string,
  label?: string
): SessionPane {
  const queuedCommand: QueuedPaneCommand = {
    id: crypto.randomUUID(),
    command,
    label,
    createdAt: new Date().toISOString(),
  };

  return touchPane(pane, {
    queuedCommands: [...pane.queuedCommands, queuedCommand],
  });
}

function buildDuplicateSessionTitle(tabs: SessionTab[], baseTitle: string) {
  const escapedBaseTitle = baseTitle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matcher = new RegExp(`^${escapedBaseTitle}(?: \\((\\d+)\\))?$`);
  const matchingTitles = tabs
    .map((tab) => tab.title)
    .map((title) => title.match(matcher))
    .filter(Boolean);

  if (!matchingTitles.length) {
    return baseTitle;
  }

  const nextIndex =
    matchingTitles.reduce((highestIndex, match) => {
      const currentIndex = Number.parseInt(match?.[1] ?? "1", 10) || 1;
      return Math.max(highestIndex, currentIndex);
    }, 1) + 1;

  return `${baseTitle} (${nextIndex})`;
}

export function openSessionWorkspace(
  state: SessionWorkspaceState,
  host: HostRecord
): SessionWorkspaceState {
  const existingTab = state.tabs.find((tab) => tab.hostId === host.id);

  if (existingTab) {
    return {
      ...state,
      activeTabId: existingTab.id,
      tabs: state.tabs.map((tab) =>
        tab.id === existingTab.id ? touchTab(tab, { activePaneId: tab.activePaneId }) : tab
      ),
    };
  }

  const pane = createSessionPane(host);
  const tab = createSessionTab(host, pane);

  return {
    tabs: [...state.tabs, tab],
    panes: {
      ...state.panes,
      [pane.id]: pane,
    },
    activeTabId: tab.id,
    lastRestoredAt: new Date().toISOString(),
  };
}

export function duplicateSessionWorkspace(
  state: SessionWorkspaceState,
  host: HostRecord,
  baseTitle = host.label
): SessionWorkspaceState {
  const title = buildDuplicateSessionTitle(state.tabs, baseTitle);
  const pane = createSessionPane(host, title);
  const tab = createSessionTab(host, pane, title);

  return {
    tabs: [...state.tabs, tab],
    panes: {
      ...state.panes,
      [pane.id]: pane,
    },
    activeTabId: tab.id,
    lastRestoredAt: new Date().toISOString(),
  };
}

export function closeSessionTab(state: SessionWorkspaceState, tabId: string): SessionWorkspaceState {
  const tab = state.tabs.find((entry) => entry.id === tabId);
  if (!tab) {
    return state;
  }

  const nextTabs = state.tabs.filter((entry) => entry.id !== tabId);
  const nextPanes = { ...state.panes };

  tab.paneIds.forEach((paneId) => {
    delete nextPanes[paneId];
  });

  return {
    ...state,
    tabs: nextTabs,
    panes: nextPanes,
    activeTabId:
      state.activeTabId === tabId ? nextTabs[nextTabs.length - 1]?.id : state.activeTabId,
  };
}

export function splitSessionPane(
  state: SessionWorkspaceState,
  tabId: string,
  host: HostRecord
): SessionWorkspaceState {
  const tab = state.tabs.find((entry) => entry.id === tabId);
  if (!tab) {
    return state;
  }

  const pane = createSessionPane(host);
  const nextTab = touchTab(tab, {
    paneIds: [...tab.paneIds, pane.id],
    activePaneId: pane.id,
  });

  return {
    ...state,
    tabs: state.tabs.map((entry) => (entry.id === tabId ? nextTab : entry)),
    panes: {
      ...state.panes,
      [pane.id]: pane,
    },
    activeTabId: tabId,
  };
}

export function removeSessionPane(
  state: SessionWorkspaceState,
  tabId: string,
  paneId: string
): SessionWorkspaceState {
  const tab = state.tabs.find((entry) => entry.id === tabId);
  if (!tab) {
    return state;
  }

  if (tab.paneIds.length <= 1) {
    return closeSessionTab(state, tabId);
  }

  const nextPaneIds = tab.paneIds.filter((entry) => entry !== paneId);
  const nextTab = touchTab(tab, {
    paneIds: nextPaneIds,
    activePaneId: tab.activePaneId === paneId ? nextPaneIds[0] : tab.activePaneId,
  });
  const nextPanes = { ...state.panes };
  delete nextPanes[paneId];

  return {
    ...state,
    tabs: state.tabs.map((entry) => (entry.id === tabId ? nextTab : entry)),
    panes: nextPanes,
  };
}

export function updatePaneConnectionState(
  state: SessionWorkspaceState,
  paneId: string,
  connectionState: SessionConnectionState
): SessionWorkspaceState {
  const pane = state.panes[paneId];
  if (!pane) {
    return state;
  }

  return {
    ...state,
    panes: {
      ...state.panes,
      [paneId]: touchPane(pane, {
        connectionState,
        reconnectOnRestore: connectionState === "connected" || pane.reconnectOnRestore,
      }),
    },
  };
}

export function updatePaneReconnectPreference(
  state: SessionWorkspaceState,
  paneId: string,
  reconnectOnRestore: boolean
): SessionWorkspaceState {
  const pane = state.panes[paneId];
  if (!pane) {
    return state;
  }

  return {
    ...state,
    panes: {
      ...state.panes,
      [paneId]: touchPane(pane, { reconnectOnRestore }),
    },
  };
}

export function updatePanePreviewPersistence<
  T extends SessionWorkspaceState & { commandHistory?: SessionCommandHistoryEntry[] },
>(
  state: T,
  paneId: string,
  persistOutputPreview: boolean
): T;
export function updatePanePreviewPersistence<
  T extends SessionWorkspaceState & { commandHistory?: SessionCommandHistoryEntry[] },
>(
  state: T,
  paneId: string,
  persistOutputPreview: boolean
): T {
  const pane = state.panes[paneId];
  if (!pane) {
    return state;
  }

  const nextCommandHistory = Array.isArray(state.commandHistory)
    ? state.commandHistory.map((entry) =>
        entry.paneId === paneId ? { ...entry, persistOutputPreview } : entry
      )
    : undefined;

  return {
    ...state,
    panes: {
      ...state.panes,
      [paneId]: touchPane(pane, { persistOutputPreview }),
    },
    ...(nextCommandHistory ? { commandHistory: nextCommandHistory } : {}),
  } as T;
}

export function updatePaneTransport(
  state: SessionWorkspaceState,
  paneId: string,
  transport: SessionTransport
): SessionWorkspaceState {
  const pane = state.panes[paneId];
  if (!pane) {
    return state;
  }

  return {
    ...state,
    panes: {
      ...state.panes,
      [paneId]: touchPane(pane, { transport }),
    },
  };
}

export function updatePaneBackendSession(
  state: SessionWorkspaceState,
  paneId: string,
  backendSessionId?: string
): SessionWorkspaceState {
  const pane = state.panes[paneId];
  if (!pane) {
    return state;
  }

  return {
    ...state,
    panes: {
      ...state.panes,
      [paneId]: touchPane(pane, { backendSessionId }),
    },
  };
}

export function queuePaneCommand(
  state: SessionWorkspaceState,
  paneId: string,
  command: string,
  label?: string
): SessionWorkspaceState {
  const pane = state.panes[paneId];
  if (!pane) {
    return state;
  }

  return {
    ...state,
    panes: {
      ...state.panes,
      [paneId]: queueCommand(pane, command, label),
    },
  };
}

export function consumePaneCommand(
  state: SessionWorkspaceState,
  paneId: string,
  commandId: string
): SessionWorkspaceState {
  const pane = state.panes[paneId];
  if (!pane) {
    return state;
  }

  return {
    ...state,
    panes: {
      ...state.panes,
      [paneId]: touchPane(pane, {
        queuedCommands: pane.queuedCommands.filter((command) => command.id !== commandId),
      }),
    },
  };
}

export function setActiveSessionTab(state: SessionWorkspaceState, tabId: string): SessionWorkspaceState {
  if (!state.tabs.some((tab) => tab.id === tabId)) {
    return state;
  }

  return {
    ...state,
    activeTabId: tabId,
  };
}

export function cycleSessionTab(
  state: SessionWorkspaceState,
  direction: 1 | -1 = 1
): SessionWorkspaceState {
  if (state.tabs.length <= 1) {
    return state;
  }

  const currentIndex = state.tabs.findIndex((tab) => tab.id === state.activeTabId);
  const startIndex = currentIndex >= 0 ? currentIndex : 0;
  const nextIndex = (startIndex + direction + state.tabs.length) % state.tabs.length;

  return {
    ...state,
    activeTabId: state.tabs[nextIndex]?.id ?? state.activeTabId,
  };
}

export function setActiveSessionPane(
  state: SessionWorkspaceState,
  tabId: string,
  paneId: string
): SessionWorkspaceState {
  return {
    ...state,
    tabs: state.tabs.map((tab) =>
      tab.id === tabId && tab.paneIds.includes(paneId)
        ? touchTab(tab, { activePaneId: paneId })
        : tab
    ),
  };
}

export function setTabSplitDirection(
  state: SessionWorkspaceState,
  tabId: string,
  splitDirection: SplitDirection
): SessionWorkspaceState {
  return {
    ...state,
    tabs: state.tabs.map((tab) =>
      tab.id === tabId ? touchTab(tab, { splitDirection }) : tab
    ),
  };
}

const MIN_SPLIT_RATIO = 0.1;
const MAX_SPLIT_RATIO = 0.9;

export function setTabSplitRatio(
  state: SessionWorkspaceState,
  tabId: string,
  ratio: number
): SessionWorkspaceState {
  // Clamp so a runaway drag never collapses a pane completely. Reject
  // non-finite inputs (NaN can sneak in from cancelled mouse-event math).
  if (!Number.isFinite(ratio)) {
    return state;
  }
  const clamped = Math.min(MAX_SPLIT_RATIO, Math.max(MIN_SPLIT_RATIO, ratio));
  return {
    ...state,
    tabs: state.tabs.map((tab) =>
      tab.id === tabId ? touchTab(tab, { splitRatio: clamped }) : tab
    ),
  };
}

export function reorderSessionTabs(
  state: SessionWorkspaceState,
  fromIndex: number,
  toIndex: number
): SessionWorkspaceState {
  if (
    fromIndex === toIndex ||
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= state.tabs.length ||
    toIndex >= state.tabs.length
  ) {
    return state;
  }
  const next = [...state.tabs];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return { ...state, tabs: next };
}

export function recordPaneCommandHistory(
  state: SessionWorkspaceState & { commandHistory: SessionCommandHistoryEntry[] },
  paneId: string,
  command: string,
  source: SessionCommandHistorySource
) {
  const pane = state.panes[paneId];
  const trimmedCommand = command.trim();
  if (!pane || !trimmedCommand) {
    return state;
  }

  const entry: SessionCommandHistoryEntry = {
    id: crypto.randomUUID(),
    paneId,
    hostId: pane.hostId,
    transport: pane.transport,
    command: trimmedCommand,
    source,
    persistOutputPreview: normalizePersistedPane(pane).persistOutputPreview,
    createdAt: new Date().toISOString(),
  };

  return {
    ...state,
    commandHistory: limitCommandHistory([entry, ...state.commandHistory]),
  };
}

export function appendPaneCommandHistoryOutput(
  state: SessionWorkspaceState & { commandHistory: SessionCommandHistoryEntry[] },
  entryId: string,
  output: string
) {
  const normalizedOutput = normalizeCommandHistoryOutput(output);
  if (!normalizedOutput) {
    return state;
  }

  const nextCommandHistory = state.commandHistory.map((entry) => {
    if (entry.id !== entryId) {
      return entry;
    }

    const outputPreview = `${entry.outputPreview ? `${entry.outputPreview}\n` : ""}${normalizedOutput}`
      .slice(-SESSION_HISTORY_OUTPUT_LIMIT)
      .trim();
    return {
      ...entry,
      outputPreview,
      outputUpdatedAt: new Date().toISOString(),
    };
  });

  return {
    ...state,
    commandHistory: nextCommandHistory,
  };
}

export interface SessionsState extends SessionWorkspaceState {
  commandHistory: SessionCommandHistoryEntry[];
  openSession: (host: HostRecord) => string;
  duplicateSession: (host: HostRecord, baseTitle?: string) => string;
  selectTab: (tabId: string) => void;
  cycleTab: (direction?: 1 | -1) => void;
  closeTab: (tabId: string) => void;
  splitTab: (tabId: string, host: HostRecord) => void;
  closePane: (tabId: string, paneId: string) => void;
  selectPane: (tabId: string, paneId: string) => void;
  setPaneState: (paneId: string, connectionState: SessionConnectionState) => void;
  setPaneReconnectOnRestore: (paneId: string, reconnectOnRestore: boolean) => void;
  setPanePersistOutputPreview: (paneId: string, persistOutputPreview: boolean) => void;
  setPaneTransport: (paneId: string, transport: SessionTransport) => void;
  setPaneBackendSession: (paneId: string, backendSessionId?: string) => void;
  queuePaneCommand: (paneId: string, command: string, label?: string) => void;
  consumePaneCommand: (paneId: string, commandId: string) => void;
  recordPaneCommand: (
    paneId: string,
    command: string,
    source?: SessionCommandHistorySource
  ) => string | undefined;
  appendCommandOutput: (entryId: string, output: string) => void;
  clearCommandHistory: () => void;
  queueCommandForHosts: (hosts: HostRecord[], command: string, label?: string) => string[];
  togglePaneConnection: (paneId: string) => void;
  setSplitDirection: (tabId: string, splitDirection: SplitDirection) => void;
  /**
   * Bonus parity round: persist a 0..1 ratio for the resizable splitter so
   * the user's drag survives a reload. Clamped to [0.1, 0.9] inside
   * setTabSplitRatio so a runaway drag never makes one pane invisible.
   */
  setSplitRatio: (tabId: string, ratio: number) => void;
  /**
   * Bonus parity round: drag-and-drop reorder for the tab strip. No-op when
   * the indices are equal or out of range so callers don't need to bounds-
   * check.
   */
  reorderTab: (fromIndex: number, toIndex: number) => void;
}

export const useSessionsStore = create<SessionsState>()(
  persist(
    (set, get) => ({
      tabs: [],
      panes: {},
      commandHistory: [],
      activeTabId: undefined,
      lastRestoredAt: undefined,
      openSession: (host) => {
        set((state) => openSessionWorkspace(state, host));
        const nextState = get();
        return nextState.activeTabId ?? "";
      },
      duplicateSession: (host, baseTitle) => {
        set((state) => duplicateSessionWorkspace(state, host, baseTitle));
        const nextState = get();
        return nextState.activeTabId ?? "";
      },
      selectTab: (tabId) => set((state) => setActiveSessionTab(state, tabId)),
      cycleTab: (direction = 1) => set((state) => cycleSessionTab(state, direction)),
      closeTab: (tabId) => set((state) => closeSessionTab(state, tabId)),
      splitTab: (tabId, host) => set((state) => splitSessionPane(state, tabId, host)),
      closePane: (tabId, paneId) => set((state) => removeSessionPane(state, tabId, paneId)),
      selectPane: (tabId, paneId) => set((state) => setActiveSessionPane(state, tabId, paneId)),
      setPaneState: (paneId, connectionState) =>
        set((state) => updatePaneConnectionState(state, paneId, connectionState)),
      setPaneReconnectOnRestore: (paneId, reconnectOnRestore) =>
        set((state) => updatePaneReconnectPreference(state, paneId, reconnectOnRestore)),
      setPanePersistOutputPreview: (paneId, persistOutputPreview) =>
        set((state) => updatePanePreviewPersistence(state, paneId, persistOutputPreview)),
      setPaneTransport: (paneId, transport) =>
        set((state) => updatePaneTransport(state, paneId, transport)),
      setPaneBackendSession: (paneId, backendSessionId) =>
        set((state) => updatePaneBackendSession(state, paneId, backendSessionId)),
      queuePaneCommand: (paneId, command, label) =>
        set((state) => queuePaneCommand(state, paneId, command, label)),
      consumePaneCommand: (paneId, commandId) =>
        set((state) => consumePaneCommand(state, paneId, commandId)),
      recordPaneCommand: (paneId, command, source = "queued") => {
        const nextState = recordPaneCommandHistory(get(), paneId, command, source);
        set(nextState);
        return nextState.commandHistory[0]?.id;
      },
      appendCommandOutput: (entryId, output) =>
        set((state) => appendPaneCommandHistoryOutput(state, entryId, output)),
      clearCommandHistory: () => set(() => ({ commandHistory: [] })),
      queueCommandForHosts: (hosts, command, label) => {
        const paneIds: string[] = [];

        set((state) => {
          let nextState: SessionWorkspaceState = state;

          hosts.forEach((host) => {
            nextState = openSessionWorkspace(nextState, host);
            const nextTab = nextState.tabs.find((tab) => tab.hostId === host.id);
            if (!nextTab) {
              return;
            }

            paneIds.push(nextTab.activePaneId);
            nextState = queuePaneCommand(nextState, nextTab.activePaneId, command, label);
          });

          return nextState;
        });

        return paneIds;
      },
      togglePaneConnection: (paneId) =>
        set((state) => {
          const current = state.panes[paneId];
          if (!current) {
            return state;
          }

          const nextState =
            current.connectionState === "connected" ? "disconnected" : "connecting";
          return updatePaneConnectionState(state, paneId, nextState);
        }),
      setSplitDirection: (tabId, splitDirection) =>
        set((state) => setTabSplitDirection(state, tabId, splitDirection)),
      setSplitRatio: (tabId, ratio) =>
        set((state) => setTabSplitRatio(state, tabId, ratio)),
      reorderTab: (fromIndex, toIndex) =>
        set((state) => reorderSessionTabs(state, fromIndex, toIndex)),
    }),
    {
      name: "termsnip-sessions",
      storage: createJSONStorage(() =>
        typeof window === "undefined" ? fallbackStorage : window.localStorage
      ),
      partialize: (state) => {
        const persistedWorkspace = sanitizePersistedWorkspace({
          tabs: state.tabs,
          panes: state.panes,
          activeTabId: state.activeTabId,
          lastRestoredAt: new Date().toISOString(),
        });

        return {
          ...persistedWorkspace,
          commandHistory: sanitizePersistedCommandHistory(
            state.commandHistory,
            persistedWorkspace.panes
          ),
        };
      },
      merge: (persistedState, currentState) => {
        const persistedWorkspace = sanitizePersistedWorkspace(
          persistedState as Pick<
            SessionWorkspaceState,
            "tabs" | "panes" | "activeTabId" | "lastRestoredAt"
          >
        );

        return {
          ...currentState,
          ...persistedWorkspace,
          commandHistory: sanitizePersistedCommandHistory(
            ((persistedState as { commandHistory?: SessionCommandHistoryEntry[] }).commandHistory ??
              currentState.commandHistory) as SessionCommandHistoryEntry[],
            persistedWorkspace.panes
          ),
        };
      },
    }
  )
);
