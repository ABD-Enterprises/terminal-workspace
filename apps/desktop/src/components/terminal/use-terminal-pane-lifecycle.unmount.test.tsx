// @vitest-environment happy-dom
//
// #375: drives the real hook through React (renderHook) so the cleanup path
// is exercised as React runs it, not as a helper called by hand. xterm is
// mocked because happy-dom has no canvas; everything else is the real module.
import { renderHook } from "@testing-library/react";
import { createRef, type MutableRefObject } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type HostRecord } from "../../types/host";
import { type SessionPane } from "../../types/session";

const terminalDispose = vi.fn();
const fitAddonDispose = vi.fn();

vi.mock("xterm", () => ({
  Terminal: class {
    cols = 80;
    rows = 24;
    attachCustomKeyEventHandler = vi.fn();
    clear = vi.fn();
    dispose = terminalDispose;
    getSelection = vi.fn(() => "");
    loadAddon = vi.fn();
    onData = vi.fn(() => ({ dispose: vi.fn() }));
    onSelectionChange = vi.fn(() => ({ dispose: vi.fn() }));
    open = vi.fn();
    paste = vi.fn();
    write = vi.fn();
    writeln = vi.fn();
  },
}));

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    activate = vi.fn();
    dispose = fitAddonDispose;
    fit = vi.fn();
    proposeDimensions = vi.fn(() => ({ cols: 80, rows: 24 }));
  },
}));

vi.mock("../../lib/api", () => ({
  connectSession: vi.fn(),
  resizeBackendSession: vi.fn(),
}));

function ref<T>(current: T): MutableRefObject<T> {
  return { current };
}

const host: HostRecord = {
  id: "host-1",
  label: "demo",
  protocol: "ssh",
  hostname: "demo.example.com",
  username: "demo",
  port: 22,
  authMethod: "password",
  privateKeyPath: "",
  group: "default",
  tags: [],
  note: "",
  favorite: false,
} as unknown as HostRecord;

const pane: SessionPane = {
  id: "pane-1",
  hostId: host.id,
  title: "demo",
  connectionState: "disconnected",
  transport: "mock",
  queuedCommands: [],
  reconnectOnRestore: false,
  persistOutputPreview: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
} as SessionPane;

describe("useTerminalPaneLifecycle unmount", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        disconnect = vi.fn();
        observe = vi.fn();
        unobserve = vi.fn();
      },
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    terminalDispose.mockClear();
    fitAddonDispose.mockClear();
  });

  it("disposes the terminal, clears the reconnect timer and closes the socket on unmount", async () => {
    const { useTerminalPaneLifecycle } = await import("./use-terminal-pane-lifecycle");

    const container = document.createElement("div");
    document.body.appendChild(container);
    const containerRef = createRef<HTMLDivElement>() as MutableRefObject<HTMLDivElement | null>;
    containerRef.current = container;

    const socket = { close: vi.fn(), send: vi.fn() };
    const socketRef = ref<unknown>(null) as MutableRefObject<never>;
    const terminalRef = ref(null);
    const fitAddonRef = ref(null);
    const reconnectTimeoutRef = ref<number | null>(null);

    const { unmount } = renderHook(() =>
      useTerminalPaneLifecycle({
        activeHistoryEntryIdRef: ref<string | undefined>(undefined),
        agentForwarding: false as HostRecord["agentForwarding"],
        appendCommandOutput: vi.fn(),
        authMethod: host.authMethod,
        backendSessionIdRef: ref<string | undefined>(undefined),
        commandBufferRef: ref(""),
        connectedOnceRef: ref(false),
        connectingRef: ref(false),
        connectionStateRef: ref(pane.connectionState),
        consumePaneCommand: vi.fn(),
        containerRef,
        demoModeEnabled: true,
        dispatchCommandRef: ref(() => {}),
        ensureConnectedRef: ref(() => {}),
        fitAddonRef,
        group: host.group,
        host,
        hostKeyPolicy: undefined as unknown as HostRecord["hostKeyPolicy"],
        hostname: host.hostname,
        id: host.id,
        initialPaletteRef: ref({} as never),
        intentionalDisconnectRef: ref(false),
        label: host.label,
        nativeBridgeEnabled: false,
        pane,
        pendingSecretsNoticeShownRef: ref(false),
        port: host.port,
        privateKeyPath: host.privateKeyPath,
        protocol: host.protocol,
        protocolLabel: "SSH",
        reconnectAttemptRef: ref(0),
        reconnectOnRestoreRef: ref(false),
        reconnectTimeoutRef,
        recordPaneCommand: vi.fn(),
        runtimeStatusRef: ref(null),
        setPaneBackendSession: vi.fn(),
        setPaneReconnectOnRestore: vi.fn(),
        setPaneState: vi.fn(),
        setPaneTransport: vi.fn(),
        setRuntimeStatusMessage: vi.fn(),
        setSearchOpen: vi.fn(),
        sftpRoot: undefined as unknown as HostRecord["sftpRoot"],
        socketRef,
        stableEnvironment: undefined as unknown as HostRecord["environment"],
        stableTags: host.tags,
        terminalRef,
        toggleConnectionRef: ref(() => {}),
        transportRef: ref(pane.transport),
        unsupportedTransport: false,
        useMockTransport: true,
        username: host.username,
      }),
    );

    // The effect ran: a terminal was created and handed to the caller's ref.
    expect(terminalRef.current).not.toBeNull();
    expect(fitAddonRef.current).not.toBeNull();

    // Simulate the state cleanup must undo: a live socket and a pending reconnect.
    (socketRef as MutableRefObject<unknown>).current = socket;
    const reconnect = vi.fn();
    reconnectTimeoutRef.current = window.setTimeout(reconnect, 1500);

    unmount();

    expect(terminalDispose).toHaveBeenCalledOnce();
    expect(fitAddonDispose).toHaveBeenCalledOnce();
    expect(socket.close).toHaveBeenCalledOnce();
    expect(reconnectTimeoutRef.current).toBeNull();
    expect(terminalRef.current).toBeNull();
    expect(fitAddonRef.current).toBeNull();
    expect((socketRef as MutableRefObject<unknown>).current).toBeNull();

    // The cleared timer must never fire.
    vi.advanceTimersByTime(5000);
    expect(reconnect).not.toHaveBeenCalled();
  });
});
