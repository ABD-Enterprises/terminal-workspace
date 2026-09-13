// @vitest-environment jsdom

import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type TerminalAnsiPalette } from "../../lib/terminal-themes";
import { useTerminalPaneLifecycle, type TerminalPaneLifecycleOptions } from "./use-terminal-pane-lifecycle";

const { MockFitAddon, MockTerminal, fitAddonInstances, terminalInstances } = vi.hoisted(() => {
  const terminalInstances: MockTerminal[] = [];
  const fitAddonInstances: MockFitAddon[] = [];

  class MockTerminal {
    cols = 80;
    rows = 24;
    options = {};
    dispose = vi.fn();
    attachCustomKeyEventHandler = vi.fn();
    clear = vi.fn();
    getSelection = vi.fn(() => "");
    loadAddon = vi.fn();
    onData = vi.fn(() => ({ dispose: vi.fn() }));
    onSelectionChange = vi.fn(() => ({ dispose: vi.fn() }));
    open = vi.fn();
    paste = vi.fn();
    write = vi.fn();
    writeln = vi.fn();

    constructor() {
      terminalInstances.push(this);
    }
  }

  class MockFitAddon {
    dispose = vi.fn();
    fit = vi.fn();

    constructor() {
      fitAddonInstances.push(this);
    }
  }

  return { MockFitAddon, MockTerminal, fitAddonInstances, terminalInstances };
});

class MockResizeObserver {
  disconnect = vi.fn();
  observe = vi.fn();
}

const testPalette: TerminalAnsiPalette = {
  background: "#000000",
  black: "#000000",
  blue: "#0000ff",
  brightBlack: "#111111",
  brightBlue: "#3333ff",
  brightCyan: "#33ffff",
  brightGreen: "#33ff33",
  brightMagenta: "#ff33ff",
  brightRed: "#ff3333",
  brightWhite: "#ffffff",
  brightYellow: "#ffff33",
  cursor: "#ffffff",
  cyan: "#00ffff",
  foreground: "#ffffff",
  green: "#00ff00",
  magenta: "#ff00ff",
  red: "#ff0000",
  white: "#eeeeee",
  yellow: "#ffff00",
};

vi.mock("xterm", () => ({ Terminal: MockTerminal }));
vi.mock("@xterm/addon-fit", () => ({ FitAddon: MockFitAddon }));
vi.mock("./terminal-pane-viewport", () => ({
  clearViewportRefreshFrame: vi.fn(),
  getPrivateViewport: vi.fn(() => ({})),
  guardViewportRefresh: vi.fn(),
}));
vi.mock("../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/api")>()),
  resizeBackendSession: vi.fn(async () => ({ ok: true })),
}));

function lifecycleOptions(overrides: Partial<TerminalPaneLifecycleOptions> = {}): TerminalPaneLifecycleOptions {
  const pane = {
    id: "pane-1",
    hostId: "host-1",
    title: "Example",
    connectionState: "disconnected" as const,
    transport: "mock" as const,
    queuedCommands: [],
    reconnectOnRestore: false,
    persistOutputPreview: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  const host = {
    id: "host-1",
    label: "Example",
    protocol: "ssh" as const,
    hostname: "example.test",
    username: "ada",
    port: 22,
    authMethod: "none" as const,
    privateKeyPath: "",
    group: "prod",
    tags: [],
    note: "",
    favorite: false,
    keyLabel: "",
    hostKeyPolicy: "allowUnknown" as const,
    agentForwarding: false,
    environment: {},
    sftpRoot: "/",
    snippetCount: 0,
    forwardingCount: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };

  return {
    activeHistoryEntryIdRef: { current: undefined },
    agentForwarding: false,
    appendCommandOutput: vi.fn(),
    authMethod: "none",
    backendSessionIdRef: { current: undefined },
    commandBufferRef: { current: "" },
    connectedOnceRef: { current: false },
    connectingRef: { current: false },
    connectionStateRef: { current: "disconnected" },
    consumePaneCommand: vi.fn(),
    containerRef: { current: document.createElement("div") },
    demoModeEnabled: true,
    dispatchCommandRef: { current: vi.fn() },
    ensureConnectedRef: { current: vi.fn() },
    fitAddonRef: { current: null },
    group: "prod",
    host,
    hostKeyPolicy: "allowUnknown",
    hostname: "example.test",
    id: "host-1",
    initialPaletteRef: { current: testPalette },
    intentionalDisconnectRef: { current: false },
    label: "Example",
    nativeBridgeEnabled: false,
    pane,
    pendingSecretsNoticeShownRef: { current: false },
    port: 22,
    privateKeyPath: "",
    protocol: "ssh",
    protocolLabel: "SSH",
    reconnectAttemptRef: { current: 0 },
    reconnectOnRestoreRef: { current: false },
    reconnectTimeoutRef: { current: null },
    recordPaneCommand: vi.fn(),
    runtimeStatusRef: { current: null },
    setPaneBackendSession: vi.fn(),
    setPaneReconnectOnRestore: vi.fn(),
    setPaneState: vi.fn(),
    setPaneTransport: vi.fn(),
    setRuntimeStatusMessage: vi.fn(),
    setSearchOpen: vi.fn(),
    sftpRoot: "/",
    socketRef: { current: null },
    stableEnvironment: {},
    stableTags: [],
    terminalRef: { current: null },
    toggleConnectionRef: { current: vi.fn() },
    transportRef: { current: "mock" },
    unsupportedTransport: false,
    useMockTransport: true,
    username: "ada",
    ...overrides,
  };
}

describe("useTerminalPaneLifecycle cleanup", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    terminalInstances.length = 0;
    fitAddonInstances.length = 0;
    vi.stubGlobal("ResizeObserver", MockResizeObserver);
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) =>
      window.setTimeout(() => callback(0), 16)
    );
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
      window.clearTimeout(id);
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("disposes the terminal and clears a pending reconnect timer on unmount", () => {
    const reconnectTimeoutRef = { current: window.setTimeout(() => undefined, 5_000) };
    const options = lifecycleOptions({ reconnectTimeoutRef });

    const { unmount } = renderHook(() => useTerminalPaneLifecycle(options));
    expect(terminalInstances).toHaveLength(1);

    unmount();

    expect(terminalInstances[0]!.dispose).toHaveBeenCalledTimes(1);
    expect(fitAddonInstances[0]!.dispose).toHaveBeenCalledTimes(1);
    expect(reconnectTimeoutRef.current).toBeNull();
    expect(options.terminalRef.current).toBeNull();
    expect(options.fitAddonRef.current).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
});
