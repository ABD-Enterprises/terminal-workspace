import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createTerminalPaneReconnectScheduler } from "./terminal-pane-reconnect";

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

it("schedules a reconnect once and drives the native connect callback", () => {
  const connectedOnceRef = { current: true };
  const connectingRef = { current: false };
  const connectionStateRef = { current: "connected" as const };
  const reconnectAttemptRef = { current: 0 };
  const reconnectOnRestoreRef = { current: false };
  const reconnectTimeoutRef = { current: null as number | null };
  const setPaneState = vi.fn();
  const connectNativeSession = vi.fn();
  const terminal = { writeln: vi.fn() };

  const scheduler = createTerminalPaneReconnectScheduler({
    connectedOnceRef,
    connectingRef,
    connectionStateRef,
    isDisposed: () => false,
    intentionalDisconnectRef: { current: false },
    paneId: "pane-1",
    protocolLabel: "SSH",
    reconnectAttemptRef,
    reconnectOnRestoreRef,
    reconnectTimeoutRef,
    setPaneState,
    terminal: terminal as never,
    unsupportedTransport: false,
    useMockTransport: false,
  });

  scheduler.scheduleReconnect(connectNativeSession, "lost carrier");
  scheduler.scheduleReconnect(connectNativeSession, "duplicate");

  expect(reconnectAttemptRef.current).toBe(1);
  expect(connectionStateRef.current).toBe("disconnected");
  expect(setPaneState).toHaveBeenCalledWith("pane-1", "disconnected");
  expect(terminal.writeln).toHaveBeenCalledWith("\r\nlost carrier Reconnecting in 2s...");

  vi.advanceTimersByTime(1_499);
  expect(connectNativeSession).not.toHaveBeenCalled();

  vi.advanceTimersByTime(1);
  expect(reconnectTimeoutRef.current).toBeNull();
  expect(connectNativeSession).toHaveBeenCalledTimes(1);
});

it("clears a pending reconnect timer", () => {
  const reconnectTimeoutRef = { current: window.setTimeout(() => undefined, 1_500) };
  const scheduler = createTerminalPaneReconnectScheduler({
    connectedOnceRef: { current: true },
    connectingRef: { current: false },
    connectionStateRef: { current: "connected" },
    isDisposed: () => false,
    intentionalDisconnectRef: { current: false },
    paneId: "pane-1",
    protocolLabel: "SSH",
    reconnectAttemptRef: { current: 0 },
    reconnectOnRestoreRef: { current: false },
    reconnectTimeoutRef,
    setPaneState: vi.fn(),
    terminal: { writeln: vi.fn() } as never,
    unsupportedTransport: false,
    useMockTransport: false,
  });

  scheduler.clearReconnectTimer();

  expect(reconnectTimeoutRef.current).toBeNull();
  expect(vi.getTimerCount()).toBe(0);
});
