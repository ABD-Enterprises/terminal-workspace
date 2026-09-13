import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createTerminalPaneMockSession } from "./terminal-pane-mock-session";

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("window", {
    clearTimeout: globalThis.clearTimeout,
    setTimeout: globalThis.setTimeout,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("connects and disconnects mock sessions with persisted pane state", () => {
  const connectionStateRef = { current: "disconnected" as const };
  const reconnectOnRestoreRef = { current: true };
  const reconnectTimeoutRef = { current: window.setTimeout(() => undefined, 5_000) };
  const setPaneReconnectOnRestore = vi.fn();
  const setPaneState = vi.fn();
  const setPaneTransport = vi.fn();
  const terminal = { write: vi.fn(), writeln: vi.fn(), clear: vi.fn() };

  const session = createTerminalPaneMockSession({
    activeHistoryEntryIdRef: { current: undefined },
    appendCommandOutput: vi.fn(),
    commandBufferRef: { current: "" },
    connectionStateRef,
    group: "prod",
    hostname: "example.test",
    intentionalDisconnectRef: { current: false },
    label: "Example",
    paneId: "pane-1",
    port: 22,
    protocol: "ssh",
    reconnectOnRestoreRef,
    reconnectTimeoutRef,
    setPaneReconnectOnRestore,
    setPaneState,
    setPaneTransport,
    sftpRoot: "/",
    stableTags: [],
    terminal: terminal as never,
    transportRef: { current: "ssh" },
    username: "ada",
  });

  session.toggleMockConnection();
  expect(connectionStateRef.current).toBe("connected");
  expect(setPaneTransport).toHaveBeenCalledWith("pane-1", "mock");
  expect(setPaneState).toHaveBeenCalledWith("pane-1", "connected");

  session.toggleMockConnection();
  expect(connectionStateRef.current).toBe("disconnected");
  expect(reconnectOnRestoreRef.current).toBe(false);
  expect(reconnectTimeoutRef.current).toBeNull();
  expect(setPaneReconnectOnRestore).toHaveBeenCalledWith("pane-1", false);
  expect(vi.getTimerCount()).toBe(0);
});

it("records mock command output and resets the active history entry", () => {
  const activeHistoryEntryIdRef = { current: "history-1" };
  const appendCommandOutput = vi.fn();
  const commandBufferRef = { current: "" };
  const terminal = { write: vi.fn(), writeln: vi.fn(), clear: vi.fn() };

  const session = createTerminalPaneMockSession({
    activeHistoryEntryIdRef,
    appendCommandOutput,
    commandBufferRef,
    connectionStateRef: { current: "connected" },
    group: "prod",
    hostname: "example.test",
    intentionalDisconnectRef: { current: false },
    label: "Example",
    paneId: "pane-1",
    port: 22,
    protocol: "ssh",
    reconnectOnRestoreRef: { current: false },
    reconnectTimeoutRef: { current: null },
    setPaneReconnectOnRestore: vi.fn(),
    setPaneState: vi.fn(),
    setPaneTransport: vi.fn(),
    sftpRoot: "/",
    stableTags: ["blue"],
    terminal: terminal as never,
    transportRef: { current: "mock" },
    username: "ada",
  });

  session.dispatchMockCommand("pwd", () => "history-1");

  expect(terminal.write).toHaveBeenCalledWith("pwd");
  expect(appendCommandOutput).toHaveBeenCalledWith("history-1", expect.stringContaining("pwd"));
  expect(activeHistoryEntryIdRef.current).toBeUndefined();
  expect(commandBufferRef.current).toBe("");
});
