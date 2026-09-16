import { type MutableRefObject } from "react";
import { type Terminal } from "xterm";
import { type SessionSocketLike } from "../../lib/api";
import { canRestoreSessionWithoutPrompt } from "../../lib/runtime-secrets";
import { type HostRecord } from "../../types/host";
import { type SessionConnectionState, type SessionPane, type SessionTransport } from "../../types/session";

export interface TerminalPaneConnectionControlsOptions {
  activeHistoryEntryIdRef: MutableRefObject<string | undefined>;
  authMethod: HostRecord["authMethod"];
  backendSessionIdRef: MutableRefObject<string | undefined>;
  commandBufferRef: MutableRefObject<string>;
  connectNativeSession: (options?: {
    announce?: boolean;
    allowPendingSecrets?: boolean;
    promptForSecrets?: boolean;
  }) => Promise<void>;
  connectionStateRef: MutableRefObject<SessionConnectionState>;
  dispatchCommandRef: MutableRefObject<(command: string) => void>;
  ensureConnectedRef: MutableRefObject<() => void>;
  intentionalDisconnectRef: MutableRefObject<boolean>;
  isDisposed: () => boolean;
  pane: SessionPane;
  pendingSecretsNoticeShownRef: MutableRefObject<boolean>;
  protocol: HostRecord["protocol"];
  readLatestHost: () => HostRecord;
  reconnectOnRestoreRef: MutableRefObject<boolean>;
  recordPaneCommand: (paneId: string, command: string, source: "queued") => string | undefined;
  runMockCommand: (command: string) => void;
  clearReconnectTimer: () => void;
  disconnectNativeSession: () => Promise<void>;
  setPaneReconnectOnRestore: (paneId: string, reconnectOnRestore: boolean) => void;
  setPaneState: (paneId: string, connectionState: SessionConnectionState) => void;
  setPaneTransport: (paneId: string, transport: SessionTransport) => void;
  setPendingSecretsState: (announce?: boolean) => void;
  socketRef: MutableRefObject<SessionSocketLike | null>;
  terminal: Pick<Terminal, "write" | "writeln">;
  toggleConnectionRef: MutableRefObject<() => void>;
  transportRef: MutableRefObject<SessionTransport>;
  unsupportedTransport: boolean;
  useMockTransport: boolean;
  writePrompt: () => void;
}

export function attachTerminalPaneConnectionControls({
  activeHistoryEntryIdRef,
  commandBufferRef,
  connectNativeSession,
  connectionStateRef,
  dispatchCommandRef,
  ensureConnectedRef,
  intentionalDisconnectRef,
  pane,
  pendingSecretsNoticeShownRef,
  reconnectOnRestoreRef,
  recordPaneCommand,
  runMockCommand,
  clearReconnectTimer,
  disconnectNativeSession,
  setPaneReconnectOnRestore,
  setPaneState,
  setPaneTransport,
  socketRef,
  terminal,
  toggleConnectionRef,
  transportRef,
  unsupportedTransport,
  useMockTransport,
  writePrompt,
  protocol,
}: TerminalPaneConnectionControlsOptions) {
  toggleConnectionRef.current = () => {
    if (unsupportedTransport) {
      connectionStateRef.current = "error";
      transportRef.current = "unsupported";
      setPaneTransport(pane.id, "unsupported");
      setPaneState(pane.id, "error");
      terminal.writeln("\r\nThis saved protocol is not executable yet.");
      return;
    }

    if (!useMockTransport) {
      if (connectionStateRef.current === "connected") {
        void disconnectNativeSession();
      } else {
        void connectNativeSession({
          announce: true,
          allowPendingSecrets: connectionStateRef.current === "pendingSecrets",
        });
      }
      return;
    }

    transportRef.current = "mock";
    setPaneTransport(pane.id, "mock");

    if (connectionStateRef.current === "connected") {
      intentionalDisconnectRef.current = true;
      clearReconnectTimer();
      connectionStateRef.current = "disconnected";
      pendingSecretsNoticeShownRef.current = false;
      reconnectOnRestoreRef.current = false;
      setPaneReconnectOnRestore(pane.id, false);
      setPaneState(pane.id, "disconnected");
      terminal.writeln("\r\nMock session disconnected.");
    } else {
      connectionStateRef.current = "connected";
      setPaneState(pane.id, "connected");
      terminal.writeln(
        protocol === "localShell"
          ? "\r\nLocal shell demo session connected."
          : "\r\nMock session connected."
      );
      writePrompt();
    }
  };

  ensureConnectedRef.current = () => {
    if (useMockTransport) {
      if (connectionStateRef.current !== "connected") {
        transportRef.current = "mock";
        connectionStateRef.current = "connected";
        setPaneTransport(pane.id, "mock");
        setPaneState(pane.id, "connected");
        writePrompt();
      }
      return;
    }

    if (unsupportedTransport) {
      return;
    }

    if (connectionStateRef.current !== "connected") {
      void connectNativeSession({
        announce: true,
        allowPendingSecrets:
          connectionStateRef.current === "pendingSecrets" || reconnectOnRestoreRef.current,
      });
    }
  };

  dispatchCommandRef.current = (command) => {
    const trimmedCommand = command.trim();

    if (!trimmedCommand) {
      writePrompt();
      return;
    }

    activeHistoryEntryIdRef.current = recordPaneCommand(pane.id, trimmedCommand, "queued");

    if (transportRef.current !== "mock" && transportRef.current !== "unsupported") {
      if (socketRef.current?.readyState === WebSocket.OPEN && connectionStateRef.current === "connected") {
        socketRef.current.send(JSON.stringify({ type: "input", data: `${trimmedCommand}\r` }));
      }
      return;
    }

    if (connectionStateRef.current !== "connected") {
      return;
    }

    terminal.write(trimmedCommand);
    commandBufferRef.current = trimmedCommand;
    runMockCommand(trimmedCommand);
  };
}

export async function initializeTerminalPaneTransport({
  authMethod,
  backendSessionIdRef,
  connectNativeSession,
  connectionStateRef,
  isDisposed,
  pane,
  protocol,
  readLatestHost,
  reconnectOnRestoreRef,
  setPaneState,
  setPaneTransport,
  setPendingSecretsState,
  transportRef,
  unsupportedTransport,
  useMockTransport,
  writePrompt,
}: TerminalPaneConnectionControlsOptions) {
  if (unsupportedTransport) {
    transportRef.current = "unsupported";
    setPaneTransport(pane.id, "unsupported");
    connectionStateRef.current = "disconnected";
    setPaneState(pane.id, "disconnected");
    return;
  }

  if (useMockTransport) {
    transportRef.current = "mock";
    setPaneTransport(pane.id, "mock");
    connectionStateRef.current = "connected";
    setPaneState(pane.id, "connected");
    writePrompt();
    return;
  }

  if (backendSessionIdRef.current) {
    await connectNativeSession({
      allowPendingSecrets: true,
      promptForSecrets: false,
    });
    return;
  }

  if (
    reconnectOnRestoreRef.current ||
    connectionStateRef.current === "pendingSecrets"
  ) {
    if (
      protocol === "localShell" ||
      protocol === "telnet" ||
      protocol === "serial" ||
      authMethod === "none" ||
      (await canRestoreSessionWithoutPrompt(readLatestHost()))
    ) {
      await connectNativeSession({
        allowPendingSecrets: true,
        promptForSecrets: false,
      });
    } else if (!isDisposed()) {
      setPendingSecretsState(true);
    }
    return;
  }

  if (connectionStateRef.current !== "disconnected") {
    await connectNativeSession();
  }
}
