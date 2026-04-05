import type { HostRecord } from "./host";

export type SessionConnectionState =
  | "connecting"
  | "connected"
  | "disconnected"
  | "pendingSecrets"
  | "error";
export type SplitDirection = "vertical" | "horizontal";
export type SessionTransport = "localShell" | "mock" | "mosh" | "serial" | "ssh" | "telnet" | "unsupported";

export interface QueuedPaneCommand {
  id: string;
  command: string;
  label?: string;
  createdAt: string;
}

export type SessionCommandHistorySource = "queued";

export interface SessionCommandHistoryEntry {
  id: string;
  paneId: string;
  hostId: string;
  transport: SessionTransport;
  command: string;
  source: SessionCommandHistorySource;
  createdAt: string;
}

export interface SessionPane {
  id: string;
  hostId: string;
  title: string;
  connectionState: SessionConnectionState;
  transport: SessionTransport;
  backendSessionId?: string;
  queuedCommands: QueuedPaneCommand[];
  reconnectOnRestore: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SessionTab {
  id: string;
  title: string;
  hostId: string;
  paneIds: string[];
  activePaneId: string;
  splitDirection: SplitDirection;
  createdAt: string;
  updatedAt: string;
}

export interface SessionWorkspaceState {
  tabs: SessionTab[];
  panes: Record<string, SessionPane>;
  activeTabId?: string;
  lastRestoredAt?: string;
}

export function createSessionPane(host: HostRecord, title = host.label): SessionPane {
  const now = new Date().toISOString();
  const transport =
    host.protocol === "localShell"
      ? "localShell"
      : host.protocol === "ssh"
        ? host.authMethod === "none"
          ? "mock"
          : "ssh"
        : host.protocol === "telnet"
          ? "telnet"
          : host.protocol === "serial"
            ? "serial"
            : host.protocol === "mosh"
              ? "mosh"
              : "unsupported";

  return {
    id: crypto.randomUUID(),
    hostId: host.id,
    title,
    connectionState: "connecting",
    transport,
    queuedCommands: [],
    reconnectOnRestore: false,
    createdAt: now,
    updatedAt: now,
  };
}

export function createSessionTab(
  host: HostRecord,
  pane = createSessionPane(host),
  title = pane.title
): SessionTab {
  const now = new Date().toISOString();

  return {
    id: crypto.randomUUID(),
    title,
    hostId: host.id,
    paneIds: [pane.id],
    activePaneId: pane.id,
    splitDirection: "vertical",
    createdAt: now,
    updatedAt: now,
  };
}

export function formatSessionConnectionState(state: SessionConnectionState) {
  switch (state) {
    case "pendingSecrets":
      return "needs secrets";
    default:
      return state;
  }
}
