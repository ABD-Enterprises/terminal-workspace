import { type MutableRefObject } from "react";
import { Terminal } from "xterm";
import {
  closeBackendSession,
  createBackendSession,
  getProtocolRuntimeStatus,
  openBackendSessionSocket,
  type SessionSocketLike,
} from "../../lib/api";
import { parseSessionFrame } from "../../lib/backend-runtime";
import { buildBackendConnectionFromKnownHost } from "../../lib/connections";
import { canRestoreSessionWithoutPrompt, ensureRuntimeSecrets } from "../../lib/runtime-secrets";
import { classifySshError } from "../../lib/ssh-error-classifier";
import { type HostRecord } from "../../types/host";
import { type SessionConnectionState, type SessionTransport } from "../../types/session";
import { type RuntimeStatusMessage } from "./use-terminal-pane-runtime-status";
import { resolveNativeSessionTransport } from "./terminal-pane-transport";

interface TrustedKnownHost {
  algorithm: string;
  publicKey: string;
}

interface ConnectNativeSessionOptions {
  announce?: boolean;
  allowPendingSecrets?: boolean;
  promptForSecrets?: boolean;
}

interface TerminalPaneNativeSessionOptions {
  activeHistoryEntryIdRef: MutableRefObject<string | undefined>;
  agentForwarding: HostRecord["agentForwarding"];
  appendCommandOutput: (historyEntryId: string, outputPreview: string) => void;
  authMethod: HostRecord["authMethod"];
  backendSessionIdRef: MutableRefObject<string | undefined>;
  clearBackendSession: () => void;
  clearReconnectTimer: () => void;
  connectedOnceRef: MutableRefObject<boolean>;
  connectingRef: MutableRefObject<boolean>;
  connectionStateRef: MutableRefObject<SessionConnectionState>;
  hostname: HostRecord["hostname"];
  hostKeyPolicy: HostRecord["hostKeyPolicy"];
  id: HostRecord["id"];
  isDisposed: () => boolean;
  intentionalDisconnectRef: MutableRefObject<boolean>;
  label: HostRecord["label"];
  paneId: string;
  pendingSecretsNoticeShownRef: MutableRefObject<boolean>;
  port: HostRecord["port"];
  privateKeyPath: HostRecord["privateKeyPath"];
  protocol: HostRecord["protocol"];
  protocolLabel: string;
  readLatestHost: () => HostRecord;
  reconnectAttemptRef: MutableRefObject<number>;
  reconnectOnRestoreRef: MutableRefObject<boolean>;
  runtimeStatusRef: MutableRefObject<RuntimeStatusMessage | null>;
  scheduleReconnect: (connectNativeSession: () => void, message?: string) => void;
  setPaneBackendSession: (paneId: string, backendSessionId: string | undefined) => void;
  setPaneReconnectOnRestore: (paneId: string, reconnectOnRestore: boolean) => void;
  setPaneState: (paneId: string, connectionState: SessionConnectionState) => void;
  setPaneTransport: (paneId: string, transport: SessionTransport) => void;
  setPendingSecretsState: (announce?: boolean) => void;
  setRuntimeStatusMessage: (status: RuntimeStatusMessage | null) => void;
  sftpRoot: HostRecord["sftpRoot"];
  socketRef: MutableRefObject<SessionSocketLike | null>;
  stableEnvironment: HostRecord["environment"];
  terminal: Terminal;
  transportRef: MutableRefObject<SessionTransport>;
  trustedKnownHost?: TrustedKnownHost;
  username: HostRecord["username"];
}

export interface TerminalPaneNativeSession {
  connectNativeSession: (options?: ConnectNativeSessionOptions) => Promise<void>;
  disconnectNativeSession: () => Promise<void>;
}

export function createTerminalPaneNativeSession({
  activeHistoryEntryIdRef,
  agentForwarding,
  appendCommandOutput,
  authMethod,
  backendSessionIdRef,
  clearBackendSession,
  clearReconnectTimer,
  connectedOnceRef,
  connectingRef,
  connectionStateRef,
  hostname,
  hostKeyPolicy,
  id,
  isDisposed,
  intentionalDisconnectRef,
  label,
  paneId,
  pendingSecretsNoticeShownRef,
  port,
  privateKeyPath,
  protocol,
  protocolLabel,
  readLatestHost,
  reconnectAttemptRef,
  reconnectOnRestoreRef,
  runtimeStatusRef,
  scheduleReconnect,
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
  username,
}: TerminalPaneNativeSessionOptions): TerminalPaneNativeSession {
  const connectNativeSession = async ({
    announce = false,
    allowPendingSecrets = false,
    promptForSecrets = true,
  }: ConnectNativeSessionOptions = {}) => {
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
      setPaneState(paneId, "error");
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
          setPaneState(paneId, "disconnected");
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
            setPaneState(paneId, "disconnected");
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
    setPaneTransport(paneId, transportRef.current);
    setPaneState(paneId, "connecting");

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
      setPaneBackendSession(paneId, sessionId);

      const socket = await openBackendSessionSocket(sessionId);
      socketRef.current = socket;

      socket.addEventListener("message", (event) => {
        if (isDisposed()) {
          return;
        }

        const message = parseSessionFrame(event.data);
        if (!message) {
          // A malformed or unrecognized frame must never throw out of this
          // listener — that would tear down the terminal data pipe for the
          // rest of the session. Drop it and keep streaming.
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
          setPaneState(paneId, message.state);
          return;
        }

        clearBackendSession();
        if (connectedOnceRef.current || reconnectOnRestoreRef.current) {
          scheduleReconnect(() => {
            void connectNativeSession({
              announce: true,
              allowPendingSecrets: true,
              promptForSecrets: false,
            });
          }, message.message);
          return;
        }

        terminal.writeln(`\r\n${message.message}`);
        connectionStateRef.current = "error";
        setPaneState(paneId, "error");
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

        scheduleReconnect(() => {
          void connectNativeSession({
            announce: true,
            allowPendingSecrets: true,
            promptForSecrets: false,
          });
        });
      });

      socket.addEventListener("error", () => {
        if (isDisposed()) {
          return;
        }

        clearBackendSession();
        if (connectedOnceRef.current || reconnectOnRestoreRef.current) {
          scheduleReconnect(
            () => {
              void connectNativeSession({
                announce: true,
                allowPendingSecrets: true,
                promptForSecrets: false,
              });
            },
            `${protocolLabel} session transport failed.`
          );
          return;
        }

        terminal.writeln(`\r\n${protocolLabel} session transport failed.`);
        connectionStateRef.current = "error";
        setPaneState(paneId, "error");
      });
    } catch (error) {
      // T16: classify the raw ssh2 / OpenSSH error string into a
      // user-facing message + actionable hint. Keep the raw error in
      // the terminal output as a follow-up line so diagnostics
      // aren't lost. Audit fix: the classifier shipped in Round 5
      // existed but wasn't wired into any error display surface.
      const classified = classifySshError(error);
      const raw = classified.raw || (error instanceof Error ? error.message : String(error));
      const friendly = classified.hint
        ? `${classified.message} ${classified.hint}`
        : classified.message;

      clearBackendSession();
      if (connectedOnceRef.current || reconnectOnRestoreRef.current) {
        scheduleReconnect(
          () => {
            void connectNativeSession({
              announce: true,
              allowPendingSecrets: true,
              promptForSecrets: false,
            });
          },
          `${protocolLabel} connect failed: ${friendly}`
        );
        return;
      }

      terminal.writeln(`\r\n${protocolLabel} connect failed.`);
      terminal.writeln(`\r\n${friendly}`);
      if (raw && raw !== classified.message) {
        terminal.writeln(`\r\n(raw: ${raw})`);
      }
      connectionStateRef.current = "error";
      setPaneState(paneId, "error");
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
    setPaneReconnectOnRestore(paneId, false);

    if (sessionId) {
      await closeBackendSession(sessionId);
    }

    connectionStateRef.current = "disconnected";
    setPaneState(paneId, "disconnected");
    terminal.writeln(`\r\n${protocolLabel} session closed.`);
  };

  return { connectNativeSession, disconnectNativeSession };
}
