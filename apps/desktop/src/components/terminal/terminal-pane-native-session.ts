import { type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { type Terminal } from "xterm";
import {
  closeBackendSession,
  createBackendSession,
  getProtocolRuntimeStatus,
  openBackendSessionSocket,
} from "../../lib/api";
import { parseSessionFrame } from "../../lib/backend-runtime";
import { buildBackendConnectionFromKnownHost } from "../../lib/connections";
import { canRestoreSessionWithoutPrompt, ensureRuntimeSecrets } from "../../lib/runtime-secrets";
import { classifySshError } from "../../lib/ssh-error-classifier";
import { type HostRecord } from "../../types/host";
import { type SessionConnectionState, type SessionPane, type SessionTransport } from "../../types/session";
import { shouldScheduleReconnect } from "./connect-failure-policy";
import { type RuntimeStatusMessage } from "./use-terminal-pane-runtime-status";
import { type TrustedKnownHost } from "./use-terminal-pane-lifecycle";

export interface TerminalPaneNativeSessionOptions {
  activeHistoryEntryIdRef: MutableRefObject<string | undefined>;
  agentForwarding: HostRecord["agentForwarding"];
  appendCommandOutput: (historyEntryId: string, outputPreview: string) => void;
  authMethod: HostRecord["authMethod"];
  backendSessionIdRef: MutableRefObject<string | undefined>;
  connectedOnceRef: MutableRefObject<boolean>;
  connectingRef: MutableRefObject<boolean>;
  connectionStateRef: MutableRefObject<SessionConnectionState>;
  hostname: HostRecord["hostname"];
  hostKeyPolicy: HostRecord["hostKeyPolicy"];
  id: HostRecord["id"];
  intentionalDisconnectRef: MutableRefObject<boolean>;
  isDisposed: () => boolean;
  label: HostRecord["label"];
  pane: SessionPane;
  pendingSecretsNoticeShownRef: MutableRefObject<boolean>;
  port: HostRecord["port"];
  privateKeyPath: HostRecord["privateKeyPath"];
  protocol: HostRecord["protocol"];
  protocolLabel: string;
  readLatestHost: () => HostRecord;
  reconnectAttemptRef: MutableRefObject<number>;
  reconnectOnRestoreRef: MutableRefObject<boolean>;
  reconnectTimeoutRef: MutableRefObject<number | null>;
  runtimeStatusRef: MutableRefObject<RuntimeStatusMessage | null>;
  setPaneBackendSession: (paneId: string, backendSessionId: string | undefined) => void;
  setPaneReconnectOnRestore: (paneId: string, reconnectOnRestore: boolean) => void;
  setPaneState: (paneId: string, connectionState: SessionConnectionState) => void;
  setPaneTransport: (paneId: string, transport: SessionTransport) => void;
  setPendingSecretsState: (announce?: boolean) => void;
  setRuntimeStatusMessage: Dispatch<SetStateAction<RuntimeStatusMessage | null>>;
  sftpRoot: HostRecord["sftpRoot"];
  socketRef: MutableRefObject<ReturnType<typeof openBackendSessionSocket> extends Promise<infer Socket> ? Socket | null : never>;
  stableEnvironment: HostRecord["environment"];
  terminal: Pick<Terminal, "write" | "writeln">;
  transportRef: MutableRefObject<SessionTransport>;
  trustedKnownHost?: TrustedKnownHost;
  unsupportedTransport: boolean;
  useMockTransport: boolean;
  username: HostRecord["username"];
}

export function createTerminalPaneNativeSessionController(options: TerminalPaneNativeSessionOptions) {
  const {
    activeHistoryEntryIdRef,
    agentForwarding,
    appendCommandOutput,
    authMethod,
    backendSessionIdRef,
    connectedOnceRef,
    connectingRef,
    connectionStateRef,
    hostname,
    hostKeyPolicy,
    id,
    intentionalDisconnectRef,
    isDisposed,
    label,
    pane,
    pendingSecretsNoticeShownRef,
    port,
    privateKeyPath,
    protocol,
    protocolLabel,
    readLatestHost,
    reconnectAttemptRef,
    reconnectOnRestoreRef,
    reconnectTimeoutRef,
    runtimeStatusRef,
    setPaneBackendSession,
    setPaneReconnectOnRestore,
    setPaneState,
    setPaneTransport,
    setPendingSecretsState,
    setRuntimeStatusMessage,
    sftpRoot,
    socketRef,
    stableEnvironment,
    terminal,
    transportRef,
    trustedKnownHost,
    unsupportedTransport,
    useMockTransport,
    username,
  } = options;

  const clearBackendSession = () => {
    if (isDisposed()) {
      return;
    }

    backendSessionIdRef.current = undefined;
    setPaneBackendSession(pane.id, undefined);
  };

  const clearReconnectTimer = () => {
    if (reconnectTimeoutRef.current == null) {
      return;
    }

    window.clearTimeout(reconnectTimeoutRef.current);
    reconnectTimeoutRef.current = null;
  };

  const scheduleReconnect = (message?: string) => {
    if (
      isDisposed() ||
      intentionalDisconnectRef.current ||
      useMockTransport ||
      unsupportedTransport ||
      (!connectedOnceRef.current && !reconnectOnRestoreRef.current)
    ) {
      return;
    }
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
    setPaneState(pane.id, "disconnected");
    terminal.writeln(
      `\r\n${message ?? `${protocolLabel} connection interrupted.`} Reconnecting in ${Math.ceil(reconnectDelayMs / 1000)}s...`
    );

    reconnectTimeoutRef.current = window.setTimeout(() => {
      reconnectTimeoutRef.current = null;
      void connectNativeSession({
        announce: true,
        allowPendingSecrets: true,
        promptForSecrets: false,
      });
    }, reconnectDelayMs);
  };

  const connectNativeSession = async ({
    announce = false,
    allowPendingSecrets = false,
    promptForSecrets = true,
  }: {
    announce?: boolean;
    allowPendingSecrets?: boolean;
    promptForSecrets?: boolean;
  } = {}) => {
    if (connectingRef.current || socketRef.current?.readyState === WebSocket.OPEN) {
      return;
    }

    if (isDisposed()) {
      return;
    }

    intentionalDisconnectRef.current = false;
    clearReconnectTimer();

    const runtimeStatus =
      runtimeStatusRef.current ?? (await getProtocolRuntimeStatus(protocol));
    const nextRuntimeStatus = {
      available: runtimeStatus.available,
      installHint: runtimeStatus.installHint,
      message: runtimeStatus.message,
    };
    runtimeStatusRef.current = nextRuntimeStatus;
    setRuntimeStatusMessage(nextRuntimeStatus);
    if (!runtimeStatus.available) {
      connectionStateRef.current = "error";
      setPaneState(pane.id, "error");
      if (announce) {
        terminal.writeln(`\r\n${runtimeStatus.message}`);
        if (runtimeStatus.installHint) {
          terminal.writeln(runtimeStatus.installHint);
        }
      }
      return;
    }

    const requiresSecrets = (protocol === "ssh" || protocol === "mosh") && authMethod !== "none";
    const hasReusableBackendSession = Boolean(backendSessionIdRef.current);
    const canConnectWithoutPrompt =
      hasReusableBackendSession || !requiresSecrets || (await canRestoreSessionWithoutPrompt(readLatestHost()));

    if (!hasReusableBackendSession) {
      if (!promptForSecrets && !canConnectWithoutPrompt) {
        if (allowPendingSecrets) {
          setPendingSecretsState(announce || connectionStateRef.current !== "pendingSecrets");
        } else {
          connectionStateRef.current = "disconnected";
          setPaneState(pane.id, "disconnected");
        }
        return;
      }

      if (promptForSecrets && requiresSecrets) {
        const readyForConnection = await ensureRuntimeSecrets(
          readLatestHost(),
          allowPendingSecrets ? "Resume SSH session" : "Open SSH session"
        );

        if (isDisposed()) {
          return;
        }

        if (!readyForConnection) {
          if (allowPendingSecrets) {
            setPendingSecretsState(true);
          } else {
            connectionStateRef.current = "disconnected";
            setPaneState(pane.id, "disconnected");
            if (announce) {
              terminal.writeln("\r\nConnection cancelled.");
            }
          }
          return;
        }
      }
    }

    pendingSecretsNoticeShownRef.current = false;
    connectingRef.current = true;
    transportRef.current = resolveNativeSessionTransport(protocol);
    setPaneTransport(pane.id, transportRef.current);
    setPaneState(pane.id, "connecting");

    if (announce) {
      terminal.writeln(
        protocol === "localShell"
          ? "\r\nOpening local shell..."
          : protocol === "serial"
            ? `\r\nOpening serial session for ${hostname}...`
            : `\r\nOpening ${protocolLabel} session to ${hostname}...`
      );
    }

    try {
      connectedOnceRef.current = false;
      const reusedExistingSession = Boolean(backendSessionIdRef.current);
      const sessionId =
        backendSessionIdRef.current ??
        (
          await createBackendSession(
            buildBackendConnectionFromKnownHost(
              {
                agentForwarding,
                authMethod,
                environment: stableEnvironment,
                hostKeyPolicy,
                hostname,
                id,
                label,
                port,
                privateKeyPath,
                protocol,
                sftpRoot,
                username,
              },
              trustedKnownHost
                ? {
                    algorithm: trustedKnownHost.algorithm,
                    publicKey: trustedKnownHost.publicKey,
                  }
                : undefined
            )
          )
        ).sessionId;
      backendSessionIdRef.current = sessionId;
      setPaneBackendSession(pane.id, sessionId);

      const socket = await openBackendSessionSocket(sessionId);
      socketRef.current = socket;

      socket.addEventListener("message", (event) => {
        if (isDisposed()) {
          return;
        }

        const message = parseSessionFrame(event.data);
        if (!message) {
          console.warn("Dropping malformed session frame");
          return;
        }

        if (message.type === "data") {
          terminal.write(message.data);
          if (activeHistoryEntryIdRef.current) {
            appendCommandOutput(activeHistoryEntryIdRef.current, message.data);
          }
          return;
        }

        if (message.type === "status") {
          if (message.state === "connected") {
            connectedOnceRef.current = true;
            reconnectOnRestoreRef.current = true;
            reconnectAttemptRef.current = 0;
          }
          connectionStateRef.current = message.state;
          setPaneState(pane.id, message.state);
          return;
        }

        clearBackendSession();
        if (connectedOnceRef.current || reconnectOnRestoreRef.current) {
          scheduleReconnect(message.message);
          return;
        }

        terminal.writeln(`\r\n${message.message}`);
        connectionStateRef.current = "error";
        setPaneState(pane.id, "error");
      });

      socket.addEventListener("close", () => {
        if (isDisposed()) {
          return;
        }

        socketRef.current = null;
        if (backendSessionIdRef.current === sessionId) {
          clearBackendSession();
        }

        if (
          !connectedOnceRef.current &&
          reusedExistingSession &&
          (protocol === "ssh" || protocol === "mosh") &&
          authMethod !== "none"
        ) {
          void connectNativeSession({
            allowPendingSecrets: true,
            promptForSecrets: false,
          });
          return;
        }

        scheduleReconnect();
      });

      socket.addEventListener("error", () => {
        if (isDisposed()) {
          return;
        }

        clearBackendSession();
        if (connectedOnceRef.current || reconnectOnRestoreRef.current) {
          scheduleReconnect(`${protocolLabel} session transport failed.`);
          return;
        }

        terminal.writeln(`\r\n${protocolLabel} session transport failed.`);
        connectionStateRef.current = "error";
        setPaneState(pane.id, "error");
      });
    } catch (error) {
      const classified = classifySshError(error);
      const raw = classified.raw || (error instanceof Error ? error.message : String(error));
      const friendly = classified.hint
        ? `${classified.message} ${classified.hint}`
        : classified.message;

      clearBackendSession();
      if (
        shouldScheduleReconnect(classified.category, {
          connectedOnce: connectedOnceRef.current,
          reconnectOnRestore: reconnectOnRestoreRef.current,
        })
      ) {
        scheduleReconnect(`${protocolLabel} connect failed: ${friendly}`);
        return;
      }

      clearReconnectTimer();
      terminal.writeln(`\r\n${protocolLabel} connect failed.`);
      terminal.writeln(`\r\n${friendly}`);
      if (raw && raw !== classified.message) {
        terminal.writeln(`\r\n(raw: ${raw})`);
      }
      connectionStateRef.current = "error";
      setPaneState(pane.id, "error");
    } finally {
      connectingRef.current = false;
    }
  };

  const disconnectNativeSession = async () => {
    const sessionId = backendSessionIdRef.current;
    intentionalDisconnectRef.current = true;
    clearReconnectTimer();
    socketRef.current?.close();
    socketRef.current = null;
    clearBackendSession();
    connectedOnceRef.current = false;
    reconnectAttemptRef.current = 0;
    pendingSecretsNoticeShownRef.current = false;
    reconnectOnRestoreRef.current = false;
    setPaneReconnectOnRestore(pane.id, false);

    if (sessionId) {
      await closeBackendSession(sessionId);
    }

    connectionStateRef.current = "disconnected";
    setPaneState(pane.id, "disconnected");
    terminal.writeln(`\r\n${protocolLabel} session closed.`);
  };

  return {
    clearBackendSession,
    clearReconnectTimer,
    connectNativeSession,
    disconnectNativeSession,
    scheduleReconnect,
  };
}

export function resolveNativeSessionTransport(protocol: HostRecord["protocol"]): Exclude<SessionTransport, "mock" | "unsupported"> {
  return protocol === "localShell"
    ? "localShell"
    : protocol === "telnet"
      ? "telnet"
      : protocol === "serial"
        ? "serial"
        : protocol === "mosh"
          ? "mosh"
          : "ssh";
}
