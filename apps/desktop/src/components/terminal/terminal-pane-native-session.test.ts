import { beforeEach, describe, expect, it, vi } from "vitest";
import { useHostsStore } from "../../store/hosts-store";
import { useKnownHostsStore } from "../../store/known-hosts-store";
import type { HostRecord } from "../../types/host";
import { createTerminalPaneNativeSessionController } from "./terminal-pane-native-session";

const g = globalThis as unknown as Record<string, unknown>;
g.window = g;
g.WebSocket = { OPEN: 1 };
// The persisted host and key stores write here when a test seeds them.
g.localStorage = { getItem: () => null, setItem: () => undefined, removeItem: () => undefined };

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

type ControllerOptions = Parameters<typeof createTerminalPaneNativeSessionController>[0];

function makeController(setPaneState = vi.fn(), overrides: Partial<ControllerOptions> = {}) {
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
    setPaneState,
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
    ...overrides,
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
    const setPaneState = vi.fn();
    const controller = makeController(setPaneState);

    await controller.connectNativeSession();
    sockets[0]!.dispatch("message", {
      data: JSON.stringify({ type: "status", state: "connected" }),
    });
    sockets[0]!.dispatch("close");
    // #510: the retry notice reaches pane state, where it is announced.
    expect(setPaneState).toHaveBeenCalledWith(
      "pane-1",
      "disconnected",
      "SSH connection interrupted. Reconnecting in 2s."
    );
    await vi.advanceTimersByTimeAsync(1_500);

    expect(openBackendSessionSocket).toHaveBeenCalledTimes(2);
    expect(openBackendSessionSocket).toHaveBeenLastCalledWith("session-2");
  });

  it("#510: keeps the retry notice when the backend's disconnected status follows its error", async () => {
    createBackendSession.mockResolvedValueOnce({ sessionId: "session-1" });
    const socket = new FakeSocket();
    openBackendSessionSocket.mockResolvedValue(socket);
    const setPaneState = vi.fn();
    const controller = makeController(setPaneState);

    await controller.connectNativeSession();
    socket.dispatch("message", { data: JSON.stringify({ type: "status", state: "connected" }) });
    socket.dispatch("message", {
      data: JSON.stringify({ type: "error", message: "SSH connection reset." }),
    });
    socket.dispatch("message", {
      data: JSON.stringify({ type: "status", state: "disconnected" }),
    });

    expect(setPaneState).toHaveBeenLastCalledWith(
      "pane-1",
      "disconnected",
      "SSH connection reset. Reconnecting in 2s."
    );
  });

  it("#510: keeps a first attempt's error and reason through the statuses that follow it", async () => {
    createBackendSession.mockResolvedValueOnce({ sessionId: "session-1" });
    const socket = new FakeSocket();
    openBackendSessionSocket.mockResolvedValue(socket);
    const setPaneState = vi.fn();
    const controller = makeController(setPaneState);

    await controller.connectNativeSession();
    socket.dispatch("message", {
      data: JSON.stringify({ type: "error", message: "Jump host refused the connection." }),
    });
    socket.dispatch("message", { data: JSON.stringify({ type: "status", state: "error" }) });
    socket.dispatch("message", {
      data: JSON.stringify({ type: "status", state: "disconnected" }),
    });

    expect(setPaneState).toHaveBeenLastCalledWith(
      "pane-1",
      "error",
      "Jump host refused the connection."
    );
  });

  it("#510: a new attempt after an error applies its own statuses", async () => {
    const sockets: FakeSocket[] = [];
    createBackendSession
      .mockResolvedValueOnce({ sessionId: "session-1" })
      .mockResolvedValueOnce({ sessionId: "session-2" });
    openBackendSessionSocket.mockImplementation(async () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    });
    const setPaneState = vi.fn();
    const controller = makeController(setPaneState);

    await controller.connectNativeSession();
    sockets[0]!.dispatch("message", {
      data: JSON.stringify({ type: "error", message: "Refused." }),
    });
    sockets[0]!.readyState = 3;
    await controller.connectNativeSession();
    // No "connected" first: the guard must already see the new attempt.
    sockets[1]!.dispatch("message", {
      data: JSON.stringify({ type: "status", state: "disconnected" }),
    });

    expect(setPaneState).toHaveBeenLastCalledWith("pane-1", "disconnected");
  });

  it("#510: retries after the backend reports a failure and leaves its socket open", async () => {
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
    sockets[0]!.dispatch("message", { data: JSON.stringify({ type: "status", state: "connected" }) });
    sockets[0]!.dispatch("message", {
      data: JSON.stringify({ type: "error", message: "SSH connection reset." }),
    });
    sockets[0]!.dispatch("message", {
      data: JSON.stringify({ type: "status", state: "disconnected" }),
    });
    await vi.advanceTimersByTimeAsync(1_500);

    expect(sockets[0]!.close).toHaveBeenCalled();
    expect(createBackendSession).toHaveBeenCalledTimes(2);
    // The ended socket's close event must not schedule a second retry.
    sockets[0]!.dispatch("close");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(createBackendSession).toHaveBeenCalledTimes(2);
  });

  it("#510: a late error from the socket the retry closed leaves the new session alone", async () => {
    const sockets: FakeSocket[] = [];
    createBackendSession
      .mockResolvedValueOnce({ sessionId: "session-1" })
      .mockResolvedValueOnce({ sessionId: "session-2" });
    openBackendSessionSocket.mockImplementation(async () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    });
    const setPaneBackendSession = vi.fn();
    const controller = makeController(vi.fn(), { setPaneBackendSession });

    await controller.connectNativeSession();
    sockets[0]!.dispatch("message", { data: JSON.stringify({ type: "status", state: "connected" }) });
    sockets[0]!.dispatch("message", {
      data: JSON.stringify({ type: "error", message: "SSH connection reset." }),
    });
    await vi.advanceTimersByTimeAsync(1_500);
    expect(createBackendSession).toHaveBeenCalledTimes(2);
    setPaneBackendSession.mockClear();

    sockets[0]!.dispatch("error");
    sockets[0]!.dispatch("message", {
      data: JSON.stringify({ type: "status", state: "disconnected" }),
    });
    await vi.advanceTimersByTimeAsync(10_000);

    expect(setPaneBackendSession).not.toHaveBeenCalled();
    expect(sockets[1]!.close).not.toHaveBeenCalled();
    expect(createBackendSession).toHaveBeenCalledTimes(2);
  });

  it("#510: does not retry when the backend reports a changed host key", async () => {
    createBackendSession.mockResolvedValueOnce({ sessionId: "session-1" });
    const socket = new FakeSocket();
    openBackendSessionSocket.mockResolvedValue(socket);
    const setPaneState = vi.fn();
    const controller = makeController(setPaneState);

    await controller.connectNativeSession();
    socket.dispatch("message", { data: JSON.stringify({ type: "status", state: "connected" }) });
    const refusal =
      "Host key verification failed for target.internal:22: the presented host key does not match the one first seen for this host.";
    socket.dispatch("message", { data: JSON.stringify({ type: "error", message: refusal }) });
    await vi.advanceTimersByTimeAsync(10_000);

    expect(createBackendSession).toHaveBeenCalledTimes(1);
    expect(setPaneState).toHaveBeenLastCalledWith("pane-1", "error", refusal);
  });

  it("#510: a changed host key stays refused when its socket then errors and closes", async () => {
    createBackendSession.mockResolvedValueOnce({ sessionId: "session-1" });
    const socket = new FakeSocket();
    openBackendSessionSocket.mockResolvedValue(socket);
    const setPaneState = vi.fn();
    const controller = makeController(setPaneState);

    await controller.connectNativeSession();
    socket.dispatch("message", { data: JSON.stringify({ type: "status", state: "connected" }) });
    const refusal = "Host key verification failed for target.internal:22: the presented host key does not match.";
    socket.dispatch("message", { data: JSON.stringify({ type: "error", message: refusal }) });
    socket.dispatch("error");
    socket.dispatch("close");
    await vi.advanceTimersByTimeAsync(10_000);

    expect(createBackendSession).toHaveBeenCalledTimes(1);
    expect(setPaneState).toHaveBeenLastCalledWith("pane-1", "error", refusal);
  });

  it("#510: a retry whose session cannot be created schedules the next retry", async () => {
    const sockets: FakeSocket[] = [];
    createBackendSession
      .mockResolvedValueOnce({ sessionId: "session-1" })
      .mockRejectedValueOnce(new Error("connect ECONNREFUSED"))
      .mockResolvedValueOnce({ sessionId: "session-3" });
    openBackendSessionSocket.mockImplementation(async () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    });
    const setPaneState = vi.fn();
    const controller = makeController(setPaneState);

    await controller.connectNativeSession();
    sockets[0]!.dispatch("message", { data: JSON.stringify({ type: "status", state: "connected" }) });
    sockets[0]!.dispatch("close");
    await vi.advanceTimersByTimeAsync(1_500);
    expect(createBackendSession).toHaveBeenCalledTimes(2);
    // The failed retry is announced and the next one is on its way.
    expect(setPaneState).toHaveBeenLastCalledWith(
      "pane-1",
      "disconnected",
      expect.stringContaining("Reconnecting in")
    );
    await vi.advanceTimersByTimeAsync(8_000);
    expect(createBackendSession).toHaveBeenCalledTimes(3);
  });

  it("#510: keeps the retry notice through an error status and then a disconnected status", async () => {
    createBackendSession.mockResolvedValueOnce({ sessionId: "session-1" });
    const socket = new FakeSocket();
    openBackendSessionSocket.mockResolvedValue(socket);
    const setPaneState = vi.fn();
    const controller = makeController(setPaneState);

    await controller.connectNativeSession();
    socket.dispatch("message", { data: JSON.stringify({ type: "status", state: "connected" }) });
    socket.dispatch("message", {
      data: JSON.stringify({ type: "error", message: "Jump host closed the channel." }),
    });
    socket.dispatch("message", { data: JSON.stringify({ type: "status", state: "error" }) });
    socket.dispatch("message", {
      data: JSON.stringify({ type: "status", state: "disconnected" }),
    });

    expect(setPaneState).toHaveBeenLastCalledWith(
      "pane-1",
      "disconnected",
      "Jump host closed the channel. Reconnecting in 2s."
    );
  });

  it("#510: an error carries its real reason into pane state", async () => {
    const sockets: FakeSocket[] = [];
    createBackendSession.mockResolvedValueOnce({ sessionId: "session-1" });
    openBackendSessionSocket.mockImplementation(async () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    });

    const setPaneState = vi.fn();
    const controller = createTerminalPaneNativeSessionController({
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
      setPaneState,
      setPaneTransport: vi.fn(),
      setPendingSecretsState: vi.fn(),
      setRuntimeStatusMessage: vi.fn(),
      sftpRoot: "/home",
      socketRef: ref<FakeSocket | null>(null) as never,
      stableEnvironment: {},
      terminal: { write: vi.fn(), writeln: vi.fn() },
      transportRef: ref("mock"),
      unsupportedTransport: false,
      useMockTransport: false,
      username: "ops",
    });

    await controller.connectNativeSession();
    sockets[0]!.dispatch("error");

    expect(setPaneState).toHaveBeenCalledWith("pane-1", "error", "SSH session transport failed.");
  });

  it("opens a new session through the configured jump host with each hop's saved key", async () => {
    useHostsStore.setState({
      hosts: [
        {
          id: "jump",
          label: "Jump",
          hostname: "jump.internal",
          port: 22,
          username: "ops",
          protocol: "ssh",
          authMethod: "password",
          privateKeyPath: "",
          hostKeyPolicy: "allowUnknown",
          agentForwarding: false,
          environment: {},
        } as unknown as HostRecord,
      ],
    });
    useKnownHostsStore.setState({
      knownHosts: [
        {
          id: "example.internal:22:ssh-ed25519",
          hostname: "example.internal",
          port: 22,
          algorithm: "ssh-ed25519",
          publicKey: "AAAATARGET",
          fingerprint: "SHA256:target",
          trustedAt: "now",
          updatedAt: "now",
        },
        {
          id: "jump.internal:22:ssh-ed25519",
          hostname: "jump.internal",
          port: 22,
          algorithm: "ssh-ed25519",
          publicKey: "AAAAJUMP",
          fingerprint: "SHA256:jump",
          trustedAt: "now",
          updatedAt: "now",
        },
      ],
    });
    createBackendSession.mockResolvedValueOnce({ sessionId: "session-1" });
    openBackendSessionSocket.mockResolvedValue(new FakeSocket());
    const controller = makeController(vi.fn(), {
      readLatestHost: () => ({ jumpHostId: "jump" }) as HostRecord,
    });

    await controller.connectNativeSession();

    const connection = createBackendSession.mock.calls[0]?.[0];
    expect(connection?.knownHostPublicKey).toBe("AAAATARGET");
    // Before this fix a new session left out the jump host entirely.
    expect(connection?.jumpHost?.hostname).toBe("jump.internal");
    expect(connection?.jumpHost?.knownHostPublicKey).toBe("AAAAJUMP");
  });
});
