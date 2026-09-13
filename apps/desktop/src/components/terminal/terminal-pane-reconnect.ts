import { type MutableRefObject } from "react";
import { Terminal } from "xterm";
import { type SessionConnectionState } from "../../types/session";

interface TerminalPaneReconnectSchedulerOptions {
  connectedOnceRef: MutableRefObject<boolean>;
  connectingRef: MutableRefObject<boolean>;
  connectionStateRef: MutableRefObject<SessionConnectionState>;
  isDisposed: () => boolean;
  intentionalDisconnectRef: MutableRefObject<boolean>;
  paneId: string;
  protocolLabel: string;
  reconnectAttemptRef: MutableRefObject<number>;
  reconnectOnRestoreRef: MutableRefObject<boolean>;
  reconnectTimeoutRef: MutableRefObject<number | null>;
  setPaneState: (paneId: string, connectionState: SessionConnectionState) => void;
  terminal: Terminal;
  unsupportedTransport: boolean;
  useMockTransport: boolean;
}

export interface TerminalPaneReconnectScheduler {
  clearReconnectTimer: () => void;
  scheduleReconnect: (connectNativeSession: () => void, message?: string) => void;
}

export function createTerminalPaneReconnectScheduler({
  connectedOnceRef,
  connectingRef,
  connectionStateRef,
  isDisposed,
  intentionalDisconnectRef,
  paneId,
  protocolLabel,
  reconnectAttemptRef,
  reconnectOnRestoreRef,
  reconnectTimeoutRef,
  setPaneState,
  terminal,
  unsupportedTransport,
  useMockTransport,
}: TerminalPaneReconnectSchedulerOptions): TerminalPaneReconnectScheduler {
  const clearReconnectTimer = () => {
    if (reconnectTimeoutRef.current == null) {
      return;
    }

    window.clearTimeout(reconnectTimeoutRef.current);
    reconnectTimeoutRef.current = null;
  };

  const scheduleReconnect = (connectNativeSession: () => void, message?: string) => {
    if (
      isDisposed() ||
      intentionalDisconnectRef.current ||
      useMockTransport ||
      unsupportedTransport ||
      (!connectedOnceRef.current && !reconnectOnRestoreRef.current)
    ) {
      return;
    }

    // M08 / #90: prevent timer pile-up. A brief network flap used
    // to spawn 3-4 reconnect attempts in parallel because socket
    // close + socket error + connect-catch all called this. Skip
    // when a reconnect is already pending OR a connect is mid-flight
    // (the connect path will schedule its own retry on failure).
    if (reconnectTimeoutRef.current !== null || connectingRef.current) {
      return;
    }

    clearReconnectTimer();
    reconnectAttemptRef.current += 1;
    const reconnectDelayMs = Math.min(
      8_000,
      reconnectAttemptRef.current <= 1 ? 1_500 : reconnectAttemptRef.current * 2_000
    );

    connectionStateRef.current = "disconnected";
    setPaneState(paneId, "disconnected");
    terminal.writeln(
      `\r\n${message ?? `${protocolLabel} connection interrupted.`} Reconnecting in ${Math.ceil(reconnectDelayMs / 1000)}s...`
    );

    reconnectTimeoutRef.current = window.setTimeout(() => {
      reconnectTimeoutRef.current = null;
      connectNativeSession();
    }, reconnectDelayMs);
  };

  return { clearReconnectTimer, scheduleReconnect };
}
