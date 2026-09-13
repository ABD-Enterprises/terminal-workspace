import { FitAddon } from "@xterm/addon-fit";
import { useEffectEvent, useLayoutEffect, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { Terminal } from "xterm";
import { resizeBackendSession, type SessionSocketLike } from "../../lib/api";
import { canRestoreSessionWithoutPrompt } from "../../lib/runtime-secrets";
import { buildTerminalIntro } from "../../lib/terminal";
import { type TerminalAnsiPalette } from "../../lib/terminal-themes";
import { type HostRecord } from "../../types/host";
import { type SessionConnectionState, type SessionPane, type SessionTransport } from "../../types/session";

import { createTerminalPaneMockSession } from "./terminal-pane-mock-session";
import { createTerminalPaneNativeSession } from "./terminal-pane-native-session";
import { createTerminalPaneReconnectScheduler } from "./terminal-pane-reconnect";
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

export function useTerminalPaneLifecycleEffect({
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
    const isDisposed = () => disposed;

    const clearBackendSession = () => {
      if (disposed) {
        return;
      }

      backendSessionIdRef.current = undefined;
      setPaneBackendSession(pane.id, undefined);
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

    const reconnectScheduler = createTerminalPaneReconnectScheduler({
      connectedOnceRef,
      connectingRef,
      connectionStateRef,
      isDisposed,
      intentionalDisconnectRef,
      paneId: pane.id,
      protocolLabel,
      reconnectAttemptRef,
      reconnectOnRestoreRef,
      reconnectTimeoutRef,
      setPaneState,
      terminal,
      unsupportedTransport,
      useMockTransport,
    });

    const mockSession = createTerminalPaneMockSession({
      activeHistoryEntryIdRef,
      appendCommandOutput,
      commandBufferRef,
      connectionStateRef,
      group,
      hostname,
      intentionalDisconnectRef,
      label,
      paneId: pane.id,
      port,
      protocol,
      reconnectOnRestoreRef,
      reconnectTimeoutRef,
      setPaneReconnectOnRestore,
      setPaneState,
      setPaneTransport,
      sftpRoot,
      stableTags,
      terminal,
      transportRef,
      username,
    });

    const nativeSession = createTerminalPaneNativeSession({
      activeHistoryEntryIdRef,
      agentForwarding,
      appendCommandOutput,
      authMethod,
      backendSessionIdRef,
      clearBackendSession,
      clearReconnectTimer: reconnectScheduler.clearReconnectTimer,
      connectedOnceRef,
      connectingRef,
      connectionStateRef,
      hostname,
      hostKeyPolicy,
      id,
      isDisposed,
      intentionalDisconnectRef,
      label,
      paneId: pane.id,
      pendingSecretsNoticeShownRef,
      port,
      privateKeyPath,
      protocol,
      protocolLabel,
      readLatestHost,
      reconnectAttemptRef,
      reconnectOnRestoreRef,
      runtimeStatusRef,
      scheduleReconnect: reconnectScheduler.scheduleReconnect,
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
    });

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
          void nativeSession.disconnectNativeSession();
        } else {
          void nativeSession.connectNativeSession({
            announce: true,
            allowPendingSecrets: connectionStateRef.current === "pendingSecrets",
          });
        }
        return;
      }

      mockSession.toggleMockConnection();
    };

    toggleConnectionRef.current = toggleConnection;
    ensureConnectedRef.current = () => {
      if (useMockTransport) {
        if (connectionStateRef.current !== "connected") {
          transportRef.current = "mock";
          connectionStateRef.current = "connected";
          setPaneTransport(pane.id, "mock");
          setPaneState(pane.id, "connected");
          mockSession.writePrompt();
        }
        return;
      }

      if (unsupportedTransport) {
        return;
      }

      if (connectionStateRef.current !== "connected") {
        void nativeSession.connectNativeSession({
          announce: true,
          allowPendingSecrets:
            connectionStateRef.current === "pendingSecrets" || reconnectOnRestoreRef.current,
        });
      }
    };
    dispatchCommandRef.current = (command) => {
      if (transportRef.current !== "mock" && transportRef.current !== "unsupported") {
        const trimmedCommand = command.trim();
        if (!trimmedCommand) {
          mockSession.writePrompt();
          return;
        }

        activeHistoryEntryIdRef.current = recordPaneCommand(pane.id, trimmedCommand, "queued");
        if (socketRef.current?.readyState === WebSocket.OPEN && connectionStateRef.current === "connected") {
          socketRef.current.send(JSON.stringify({ type: "input", data: `${trimmedCommand}\r` }));
        }
        return;
      }

      mockSession.dispatchMockCommand(command, () => recordPaneCommand(pane.id, command.trim(), "queued"));
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

    const selectionDisposable = terminal.onSelectionChange(() => {
      const selection = terminal.getSelection();
      if (!selection || typeof navigator === "undefined" || !navigator.clipboard) {
        return;
      }
      navigator.clipboard.writeText(selection).catch(() => {});
    });

    const contextMenuHandler = (event: MouseEvent) => {
      event.preventDefault();
      if (typeof navigator === "undefined" || !navigator.clipboard) {
        return;
      }
      navigator.clipboard
        .readText()
        .then((text) => {
          if (text) {
            terminal.paste(text);
          }
        })
        .catch(() => {});
    };
    container.addEventListener("contextmenu", contextMenuHandler);

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
        mockSession.runMockCommand(commandBufferRef.current);
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
        mockSession.writePrompt();
        return;
      }

      if (backendSessionIdRef.current) {
        await nativeSession.connectNativeSession({
          allowPendingSecrets: true,
          promptForSecrets: false,
        });
        return;
      }

      if (reconnectOnRestoreRef.current || connectionStateRef.current === "pendingSecrets") {
        if (
          protocol === "localShell" ||
          protocol === "telnet" ||
          protocol === "serial" ||
          authMethod === "none" ||
          (await canRestoreSessionWithoutPrompt(readLatestHost()))
        ) {
          await nativeSession.connectNativeSession({
            allowPendingSecrets: true,
            promptForSecrets: false,
          });
        } else if (!disposed) {
          setPendingSecretsState(true);
        }
        return;
      }

      if (connectionStateRef.current !== "disconnected") {
        await nativeSession.connectNativeSession();
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
      reconnectScheduler.clearReconnectTimer();
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
