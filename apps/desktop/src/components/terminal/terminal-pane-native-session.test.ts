import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTerminalPaneNativeSessionController } from "./terminal-pane-native-session";

const g = globalThis as unknown as Record<string, unknown>;
g.window = g;
g.WebSocket = { OPEN: 1 };

const createBackendSession = vi.fn();
const getProtocolRuntimeStatus = vi.fn();
const openBackendSessionSocket = vi.fn();

vi.mock("../../lib/api", () => ({
  closeBackendSession: vi.fn(),
  createBackendSession: (...args: unknown[]) => createBackendSession(...args),
  getProtocolRuntimeStatus: (...args: unknown[]) => getProtocolRuntimeStatus(...args),
  openBackendSessionSocket: (...args: unknown[]) => openBackendSessionSocket(...args),
}));

vi.mock("../../lib/runtime-secrets", () => ({
  canRestoreSessionWithoutPrompt: vi.fn(async () => true),
  ensureRuntimeSecrets: vi.fn(async () => true),
}));

function ref<T>(current: T) {
  return { current };
}

class FakeSocket {
  readyState = 1;
  listeners = new Map<string, Array<(event: { data?: string }) => void>>();
  addEventListener(type: string, listener: (event: { data?: string }) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  close = vi.fn();
  send = vi.fn();
  dispatch(type: string, event: { data?: string } = {}) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }
}

function makeController() {
  const socketRef = ref<FakeSocket | null>(null);
  return createTerminalPaneNativeSessionController({
    activeHistoryEntryIdRef: ref<string | undefined>(undefined),
    agentForwarding: false,
    appendCommandOutput: vi.fn(),
    authMethod: "none",
    backendSessionIdRef: ref<string | undefined>(undefined),
    connectedOnceRef: ref(false),
    connectingRef: ref(false),
    connectionStateRef: ref("connecting"),
    hostname: "example.internal",
    hostKeyPolicy: "allowUnknown",
    id: "host-1",
    intentionalDisconnectRef: ref(false),
    isDisposed: () => false,
    label: "Example",
    pane: {
      id: "pane-1",
      hostId: "host-1",
      title: "Example",
      connectionState: "connecting",
      transport: "ssh",
      queuedCommands: [],
      reconnectOnRestore: false,
      persistOutputPreview: true,
      createdAt: "now",
      updatedAt: "now",
    },
    pendingSecretsNoticeShownRef: ref(false),
    port: 22,
    privateKeyPath: "",
    protocol: "ssh",
    protocolLabel: "SSH",
    readLatestHost: () => ({}) as never,
    reconnectAttemptRef: ref(0),
    reconnectOnRestoreRef: ref(false),
    reconnectTimeoutRef: ref<number | null>(null),
    runtimeStatusRef: ref({ available: true, message: "ready" }),
    setPaneBackendSession: vi.fn(),
    setPaneReconnectOnRestore: vi.fn(),
    setPaneState: vi.fn(),
    setPaneTransport: vi.fn(),
    setPendingSecretsState: vi.fn(),
    setRuntimeStatusMessage: vi.fn(),
    sftpRoot: "/home",
    socketRef: socketRef as never,
    stableEnvironment: {},
    terminal: { write: vi.fn(), writeln: vi.fn() },
    transportRef: ref("mock"),
    unsupportedTransport: false,
    useMockTransport: false,
    username: "ops",
  });
}

describe("createTerminalPaneNativeSessionController", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    createBackendSession.mockReset();
    getProtocolRuntimeStatus.mockResolvedValue({ available: true, message: "ready" });
    openBackendSessionSocket.mockReset();
  });

  it("schedules a reconnect end to end when a connected socket closes", async () => {
    const sockets: FakeSocket[] = [];
    createBackendSession
      .mockResolvedValueOnce({ sessionId: "session-1" })
      .mockResolvedValueOnce({ sessionId: "session-2" });
    openBackendSessionSocket.mockImplementation(async () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    });
    const controller = makeController();

    await controller.connectNativeSession();
    sockets[0]!.dispatch("message", {
      data: JSON.stringify({ type: "status", state: "connected" }),
    });
    sockets[0]!.dispatch("close");
    await vi.advanceTimersByTimeAsync(1_500);

    expect(openBackendSessionSocket).toHaveBeenCalledTimes(2);
    expect(openBackendSessionSocket).toHaveBeenLastCalledWith("session-2");
  });
});
