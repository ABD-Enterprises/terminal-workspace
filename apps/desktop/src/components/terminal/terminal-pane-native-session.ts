import { type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { type Terminal } from "xterm";
import {
  closeBackendSession,
  createBackendSession,
  getProtocolRuntimeStatus,
  openBackendSessionSocket,
} from "../../lib/api";
import { parseSessionFrame } from "../../lib/backend-runtime";
import { buildBackendConnection } from "../../lib/connections";
import { canRestoreSessionWithoutPrompt, ensureRuntimeSecrets } from "../../lib/runtime-secrets";
import { classifySshError } from "../../lib/ssh-error-classifier";
import { useKnownHostsStore } from "../../store/known-hosts-store";
import { type HostRecord } from "../../types/host";
import { type SessionConnectionState, type SessionPane, type SessionTransport } from "../../types/session";
import { shouldScheduleReconnect } from "./connect-failure-policy";
import { type RuntimeStatusMessage } from "./use-terminal-pane-runtime-status";

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
  setPaneState: (paneId: string, connectionState: SessionConnectionState, connectionError?: string) => void;
  setPaneTransport: (paneId: string, transport: SessionTransport) => void;
  setPendingSecretsState: (announce?: boolean) => void;
  setRuntimeStatusMessage: Dispatch<SetStateAction<RuntimeStatusMessage | null>>;
  sftpRoot: HostRecord["sftpRoot"];
  socketRef: MutableRefObject<ReturnType<typeof openBackendSessionSocket> extends Promise<infer Socket> ? Socket | null : never>;
  stableEnvironment: HostRecord["environment"];
  terminal: Pick<Terminal, "write" | "writeln">;
  transportRef: MutableRefObject<SessionTransport>;
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

    // #510: the reason and the retry go into pane state too, not only into the
    // terminal, so the pane's status announcement can say them.
    const reconnectNotice = `${message ?? `${protocolLabel} connection interrupted.`} Reconnecting in ${Math.ceil(reconnectDelayMs / 1000)}s.`;
    connectionStateRef.current = "disconnected";
    setPaneState(pane.id, "disconnected", reconnectNotice);
    terminal.writeln(`\r\n${reconnectNotice}..`);

    reconnectTimeoutRef.current = window.setTimeout(() => {
      reconnectTimeoutRef.current = null;
      // #510: the browser backend reports a failed session and leaves its
      // socket open. An open socket makes connectNativeSession return without
      // retrying, which left the "Reconnecting" notice up for good. The
      // session is over, so close the socket; its close handler ignores a
      // socket that is no longer the current one.
      const endedSocket = socketRef.current;
      if (endedSocket) {
        socketRef.current = null;
        endedSocket.close();
      }
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
      setPaneState(pane.id, "error", runtimeStatus.message);
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
    // Set here, not only by the next render: the status guard below reads it.
    connectionStateRef.current = "connecting";
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
            // The configured jump host and every saved host key, read when
            // connecting: a session built from the target's fields alone
            // skipped the jump host and its approved key. Restored sessions
            // are built the same way (SessionRestoreManager).
            buildBackendConnection(
              {
                agentForwarding,
                authMethod,
                environment: stableEnvironment,
                hostKeyPolicy,
                hostname,
                id,
                jumpHostId: readLatestHost().jumpHostId,
                label,
                port,
                privateKeyPath,
                protocol,
                sftpRoot,
                username,
              },
              useKnownHostsStore.getState().knownHosts
            )
          )
        ).sessionId;
      backendSessionIdRef.current = sessionId;
      setPaneBackendSession(pane.id, sessionId);

      const socket = await openBackendSessionSocket(sessionId);
      socketRef.current = socket;

      socket.addEventListener("message", (event) => {
        // A replaced socket (see the close handler) must not touch the pane.
        if (isDisposed() || socketRef.current !== socket) {
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
          // #510: a failing session sends its error, then "error" and/or
          // "disconnected" statuses. Once the error has been handled (a retry
          // is pending with its reason and countdown, or the pane shows the
          // error with its reason), those end-of-session statuses must not
          // replace it with a bare "disconnected". A new attempt sets
          // "connecting" first, so its own statuses still apply.
          if (
            (message.state === "disconnected" || message.state === "error") &&
            (reconnectTimeoutRef.current !== null || connectionStateRef.current === "error")
          ) {
            return;
          }
          connectionStateRef.current = message.state;
          setPaneState(pane.id, message.state);
          return;
        }

        clearBackendSession();
        // The same retry rule as a failed connect: a changed host key is
        // never retried, the user has to re-scan and trust it first.
        if (
          shouldScheduleReconnect(classifySshError(message.message).category, {
            connectedOnce: connectedOnceRef.current,
            reconnectOnRestore: reconnectOnRestoreRef.current,
          })
        ) {
          scheduleReconnect(message.message);
          return;
        }

        terminal.writeln(`\r\n${message.message}`);
        connectionStateRef.current = "error";
        setPaneState(pane.id, "error", message.message);
      });

      socket.addEventListener("close", () => {
        // A socket that is no longer the current one was closed on purpose
        // (a manual disconnect, unmount, or the retry above), and whoever
        // closed it has already cleaned up; it must not schedule a retry.
        if (isDisposed() || socketRef.current !== socket) {
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

        // #510: the session already ended with an error the pane shows and
        // decided not to retry (for example a changed host key). Its socket
        // closing afterwards must not start a retry that hides it.
        if (connectionStateRef.current === "error") {
          return;
        }

        scheduleReconnect();
      });

      socket.addEventListener("error", () => {
        if (isDisposed() || socketRef.current !== socket) {
          return;
        }

        clearBackendSession();
        if (connectedOnceRef.current || reconnectOnRestoreRef.current) {
          scheduleReconnect(`${protocolLabel} session transport failed.`);
          return;
        }

        terminal.writeln(`\r\n${protocolLabel} session transport failed.`);
        connectionStateRef.current = "error";
        setPaneState(pane.id, "error", `${protocolLabel} session transport failed.`);
      });
    } catch (error) {
      // #510: this attempt is over. Clear the flag before deciding on a
      // retry: scheduleReconnect does nothing while an attempt is in
      // progress, which left a failed retry stuck on "connecting".
      connectingRef.current = false;
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
      setPaneState(pane.id, "error", friendly);
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
