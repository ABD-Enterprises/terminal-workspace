import { FitAddon } from "@xterm/addon-fit";
import { useEffectEvent, useLayoutEffect, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { Terminal } from "xterm";
import {
  closeBackendSession,
  createBackendSession,
  getProtocolRuntimeStatus,
  openBackendSessionSocket,
  resizeBackendSession,
  type SessionSocketLike,
} from "../../lib/api";
import { parseSessionFrame } from "../../lib/backend-runtime";
import { buildBackendConnectionFromKnownHost } from "../../lib/connections";
import { canRestoreSessionWithoutPrompt, ensureRuntimeSecrets } from "../../lib/runtime-secrets";
import { buildMockCommandResponse, buildTerminalIntro, formatPrompt } from "../../lib/terminal";
import { type TerminalAnsiPalette } from "../../lib/terminal-themes";
import { classifySshError } from "../../lib/ssh-error-classifier";
import { type HostRecord } from "../../types/host";
import { type SessionConnectionState, type SessionPane, type SessionTransport } from "../../types/session";

import { clearViewportRefreshFrame, getPrivateViewport, guardViewportRefresh } from "./terminal-pane-viewport";
import { type RuntimeStatusMessage } from "./use-terminal-pane-runtime-status";

interface TrustedKnownHost {
  algorithm: string;
  publicKey: string;
}

export interface TerminalPaneLifecycleOptions {
  activeHistoryEntryIdRef: MutableRefObject<string | undefined>;
  agentForwarding: HostRecord["agentForwarding"];
  appendCommandOutput: (historyEntryId: string, outputPreview: string) => void;
  authMethod: HostRecord["authMethod"];
  backendSessionIdRef: MutableRefObject<string | undefined>;
  commandBufferRef: MutableRefObject<string>;
  connectedOnceRef: MutableRefObject<boolean>;
  connectingRef: MutableRefObject<boolean>;
  connectionStateRef: MutableRefObject<SessionConnectionState>;
  consumePaneCommand: (paneId: string, commandId: string) => void;
  containerRef: MutableRefObject<HTMLDivElement | null>;
  demoModeEnabled: boolean;
  dispatchCommandRef: MutableRefObject<(command: string) => void>;
  ensureConnectedRef: MutableRefObject<() => void>;
  fitAddonRef: MutableRefObject<FitAddon | null>;
  group: HostRecord["group"];
  host: HostRecord;
  hostKeyPolicy: HostRecord["hostKeyPolicy"];
  hostname: HostRecord["hostname"];
  id: HostRecord["id"];
  initialPaletteRef: MutableRefObject<TerminalAnsiPalette>;
  intentionalDisconnectRef: MutableRefObject<boolean>;
  label: HostRecord["label"];
  nativeBridgeEnabled: boolean;
  pane: SessionPane;
  pendingSecretsNoticeShownRef: MutableRefObject<boolean>;
  port: HostRecord["port"];
  privateKeyPath: HostRecord["privateKeyPath"];
  protocol: HostRecord["protocol"];
  protocolLabel: string;
  reconnectAttemptRef: MutableRefObject<number>;
  reconnectOnRestoreRef: MutableRefObject<boolean>;
  reconnectTimeoutRef: MutableRefObject<number | null>;
  recordPaneCommand: (paneId: string, command: string, source: "queued") => string | undefined;
  runtimeStatusRef: MutableRefObject<RuntimeStatusMessage | null>;
  setPaneBackendSession: (paneId: string, backendSessionId: string | undefined) => void;
  setPaneReconnectOnRestore: (paneId: string, reconnectOnRestore: boolean) => void;
  setPaneState: (paneId: string, connectionState: SessionConnectionState) => void;
  setPaneTransport: (paneId: string, transport: SessionTransport) => void;
  setRuntimeStatusMessage: Dispatch<SetStateAction<RuntimeStatusMessage | null>>;
  setSearchOpen: Dispatch<SetStateAction<boolean>>;
  sftpRoot: HostRecord["sftpRoot"];
  socketRef: MutableRefObject<SessionSocketLike | null>;
  stableEnvironment: HostRecord["environment"];
  stableTags: HostRecord["tags"];
  terminalRef: MutableRefObject<Terminal | null>;
  toggleConnectionRef: MutableRefObject<() => void>;
  transportRef: MutableRefObject<SessionTransport>;
  trustedKnownHost?: TrustedKnownHost;
  unsupportedTransport: boolean;
  useMockTransport: boolean;
  username: HostRecord["username"];
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

export function useTerminalPaneLifecycle({
  activeHistoryEntryIdRef,
  agentForwarding,
  appendCommandOutput,
  authMethod,
  backendSessionIdRef,
  commandBufferRef,
  connectedOnceRef,
  connectingRef,
  connectionStateRef,
  consumePaneCommand,
  containerRef,
  demoModeEnabled,
  dispatchCommandRef,
  ensureConnectedRef,
  fitAddonRef,
  group,
  host,
  hostKeyPolicy,
  hostname,
  id,
  initialPaletteRef,
  intentionalDisconnectRef,
  label,
  nativeBridgeEnabled,
  pane,
  pendingSecretsNoticeShownRef,
  port,
  privateKeyPath,
  protocol,
  protocolLabel,
  reconnectAttemptRef,
  reconnectOnRestoreRef,
  reconnectTimeoutRef,
  recordPaneCommand,
  runtimeStatusRef,
  setPaneBackendSession,
  setPaneReconnectOnRestore,
  setPaneState,
  setPaneTransport,
  setRuntimeStatusMessage,
  setSearchOpen,
  sftpRoot,
  socketRef,
  stableEnvironment,
  stableTags,
  terminalRef,
  toggleConnectionRef,
  transportRef,
  trustedKnownHost,
  unsupportedTransport,
  useMockTransport,
  username,
}: TerminalPaneLifecycleOptions) {
  /*
   * #175: the whole `host` object is passed to two async secret helpers inside
   * the effect. It cannot be a dependency — `markConnected` changes
   * `lastConnectedAt`, so the object differs on every connect even when nothing
   * the terminal cares about did. Reading it through an Effect Event gets the
   * LATEST host at call time without making the effect re-run, which is exactly
   * the semantics those checks want: they run seconds after setup, and should
   * see current state rather than a snapshot.
   */
  const readLatestHost = useEffectEvent(() => host);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const terminal = new Terminal({
      cursorBlink: true,
      fontFamily: '"SFMono-Regular", "Menlo", "Monaco", monospace',
      fontSize: 13,
      theme: initialPaletteRef.current,
    });
    const fitAddon = new FitAddon();
    let fitFrameId: number | null = null;
    let disposed = false;

    const writePrompt = () => {
      const prompt = formatPrompt({ label, protocol, username });
      commandBufferRef.current = "";
      terminal.write(`\r\n${prompt}`);
    };

    const setPendingSecretsState = (announce = false) => {
      connectionStateRef.current = "pendingSecrets";
      setPaneState(pane.id, "pendingSecrets");

      if (!announce || pendingSecretsNoticeShownRef.current) {
        return;
      }

      terminal.writeln(
        "\r\nSession restore is waiting for runtime credentials. Click Resume when you are ready to continue."
      );
      pendingSecretsNoticeShownRef.current = true;
    };

    const runMockCommand = (command: string) => {
      let outputPreview = "";
      if (command.trim() === "clear") {
        terminal.clear();
      } else {
        const responseLines = buildMockCommandResponse(command, {
          group,
          hostname,
          label,
          port,
          protocol,
          sftpRoot,
          tags: stableTags,
          username,
        });
        responseLines.forEach((line) => terminal.writeln(line));
        outputPreview = responseLines.join("\n");
      }

      if (activeHistoryEntryIdRef.current && outputPreview) {
        appendCommandOutput(activeHistoryEntryIdRef.current, outputPreview);
      }
      activeHistoryEntryIdRef.current = undefined;
      writePrompt();
    };

    const clearBackendSession = () => {
      if (disposed) {
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
        disposed ||
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

    const scheduleFit = () => {
      if (disposed) {
        return;
      }

      if (fitFrameId !== null) {
        window.cancelAnimationFrame(fitFrameId);
      }

      fitFrameId = window.requestAnimationFrame(() => {
        if (disposed) {
          return;
        }

        try {
          fitAddon.fit();

          if (
            transportRef.current !== "mock" &&
            transportRef.current !== "unsupported" &&
            backendSessionIdRef.current
          ) {
            void resizeBackendSession(backendSessionIdRef.current, {
              cols: terminal.cols,
              rows: terminal.rows,
            }).catch(() => {
              clearBackendSession();
            });
          }
        } catch {
          // xterm can transiently report missing dimensions during initial layout.
        }
      });
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

      if (disposed) {
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

          if (disposed) {
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
          if (disposed) {
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
          if (disposed) {
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
          if (disposed) {
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
          scheduleReconnect(`${protocolLabel} connect failed: ${friendly}`);
          return;
        }

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

    const toggleConnection = () => {
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

    toggleConnectionRef.current = toggleConnection;
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

    terminal.loadAddon(fitAddon);
    terminal.open(container);
    guardViewportRefresh(terminal);
    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    buildTerminalIntro(
      { hostname, label, port, protocol, username },
      connectionStateRef.current === "connected",
      {
        demoModeEnabled,
        nativeBridgeEnabled,
        unsupportedTransport,
      }
    ).forEach((line) => {
      terminal.writeln(line);
    });

    // Copy-on-select: when the user finishes selecting text in the terminal,
    // copy it to the clipboard automatically. Mirrors the behaviour other clients
    // / iTerm2 / native macOS Terminal users expect — see parity-and-hardening
    // review §4.4. We swallow clipboard errors so a denied permission does
    // not break terminal interaction.
    const selectionDisposable = terminal.onSelectionChange(() => {
      const selection = terminal.getSelection();
      if (!selection) {
        return;
      }
      if (typeof navigator === "undefined" || !navigator.clipboard) {
        return;
      }
      navigator.clipboard.writeText(selection).catch(() => {});
    });

    // Right-click paste: matches the macOS / default shell idiom. We prevent the
    // default browser context menu (which would offer Inspect Element etc.
    // in dev) and inject the clipboard contents into the terminal as if the
    // user typed them. xterm's paste() goes through onData, so the SSH
    // transport sees it the same as keystrokes.
    const contextMenuHandler = (event: MouseEvent) => {
      event.preventDefault();
      if (typeof navigator === "undefined" || !navigator.clipboard) {
        return;
      }
      navigator.clipboard
        .readText()
        .then((text) => {
          if (!text) {
            return;
          }
          terminal.paste(text);
        })
        .catch(() => {});
    };
    container.addEventListener("contextmenu", contextMenuHandler);

    // Cmd/Ctrl+F intercept: open the in-pane search overlay instead of
    // letting xterm consume the key as plain input. Returning false from
    // attachCustomKeyEventHandler tells xterm not to handle the event.
    // See parity-and-hardening-plan.md P1-UX6.
    terminal.attachCustomKeyEventHandler((event) => {
      if (event.type !== "keydown") {
        return true;
      }
      const isMeta = event.metaKey || event.ctrlKey;
      if (isMeta && (event.key === "f" || event.key === "F")) {
        event.preventDefault();
        setSearchOpen(true);
        return false;
      }
      return true;
    });

    const disposable = terminal.onData((data) => {
      if (
        transportRef.current !== "mock" &&
        transportRef.current !== "unsupported" &&
        socketRef.current?.readyState === WebSocket.OPEN
      ) {
        socketRef.current.send(JSON.stringify({ type: "input", data }));
        return;
      }

      if (connectionStateRef.current !== "connected") {
        return;
      }

      if (data === "\r") {
        runMockCommand(commandBufferRef.current);
        return;
      }

      if (data === "\u007f") {
        if (commandBufferRef.current.length > 0) {
          commandBufferRef.current = commandBufferRef.current.slice(0, -1);
          terminal.write("\b \b");
        }
        return;
      }

      if (data >= " ") {
        commandBufferRef.current += data;
        terminal.write(data);
      }
    });

    const observer = new ResizeObserver(() => {
      scheduleFit();
    });
    observer.observe(container);
    scheduleFit();

    const initializeTransport = async () => {
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
        } else if (!disposed) {
          setPendingSecretsState(true);
        }
        return;
      }

      if (connectionStateRef.current !== "disconnected") {
        await connectNativeSession();
      }
    };

    void initializeTransport();

    return () => {
      disposed = true;
      observer.disconnect();
      disposable.dispose();
      selectionDisposable.dispose();
      container.removeEventListener("contextmenu", contextMenuHandler);
      if (fitFrameId !== null) {
        window.cancelAnimationFrame(fitFrameId);
      }
      clearReconnectTimer();
      socketRef.current?.close();
      socketRef.current = null;
      clearViewportRefreshFrame(getPrivateViewport(terminal));
      fitAddon.dispose();
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- dependency array preserved verbatim from useTerminalPaneSession.
  }, [
    agentForwarding,
    authMethod,
    consumePaneCommand,
    stableEnvironment,
    group,
    hostname,
    hostKeyPolicy,
    id,
    label,
    demoModeEnabled,
    protocol,
    trustedKnownHost,
    port,
    pane.id,
    privateKeyPath,
    nativeBridgeEnabled,
    appendCommandOutput,
    recordPaneCommand,
    protocolLabel,
    setPaneBackendSession,
    setPaneReconnectOnRestore,
    setPaneState,
    setPaneTransport,
    sftpRoot,
    stableTags,
    unsupportedTransport,
    useMockTransport,
    username,
  ]);
}
