import { FitAddon } from "@xterm/addon-fit";
import { useEffectEvent, useLayoutEffect, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { Terminal } from "xterm";
import { resizeBackendSession, type SessionSocketLike } from "../../lib/api";
import { buildTerminalIntro } from "../../lib/terminal";
import { type TerminalAnsiPalette } from "../../lib/terminal-themes";
import { type HostRecord } from "../../types/host";
import { type SessionConnectionState, type SessionPane, type SessionTransport } from "../../types/session";

import { cleanupTerminalPaneLifecycle } from "./terminal-pane-cleanup";
import { guardViewportRefresh } from "./terminal-pane-viewport";
import {
  attachTerminalPaneConnectionControls,
  initializeTerminalPaneTransport,
} from "./terminal-pane-connection-controls";
import { attachTerminalPaneInputWiring } from "./terminal-pane-input-wiring";
import { createTerminalPaneMockSession } from "./terminal-pane-mock-session";
import { createTerminalPaneNativeSessionController } from "./terminal-pane-native-session";
import { type RuntimeStatusMessage } from "./use-terminal-pane-runtime-status";

export interface TrustedKnownHost {
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

export { resolveNativeSessionTransport } from "./terminal-pane-native-session";

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

    const { runMockCommand, writePrompt } = createTerminalPaneMockSession({
      activeHistoryEntryIdRef,
      appendCommandOutput,
      commandBufferRef,
      group,
      hostname,
      label,
      port,
      protocol,
      sftpRoot,
      stableTags,
      terminal,
      username,
    });

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

    const nativeSessionController = createTerminalPaneNativeSessionController({
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
      isDisposed: () => disposed,
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
    });
    const {
      clearBackendSession,
      clearReconnectTimer,
      connectNativeSession,
      disconnectNativeSession,
    } = nativeSessionController;

    const connectionControlsOptions = {
      activeHistoryEntryIdRef,
      authMethod,
      backendSessionIdRef,
      commandBufferRef,
      connectNativeSession,
      connectionStateRef,
      dispatchCommandRef,
      ensureConnectedRef,
      intentionalDisconnectRef,
      isDisposed: () => disposed,
      pane,
      pendingSecretsNoticeShownRef,
      protocol,
      readLatestHost,
      reconnectOnRestoreRef,
      recordPaneCommand,
      runMockCommand,
      clearReconnectTimer,
      disconnectNativeSession,
      setPaneReconnectOnRestore,
      setPaneState,
      setPaneTransport,
      setPendingSecretsState,
      socketRef,
      terminal,
      toggleConnectionRef,
      transportRef,
      unsupportedTransport,
      useMockTransport,
      writePrompt,
    };
    attachTerminalPaneConnectionControls(connectionControlsOptions);

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

    const { contextMenuHandler, dataDisposable, selectionDisposable } = attachTerminalPaneInputWiring({
      commandBufferRef,
      connectionStateRef,
      container,
      runMockCommand,
      setSearchOpen,
      socketRef,
      terminal,
      transportRef,
    });

    const observer = new ResizeObserver(() => {
      scheduleFit();
    });
    observer.observe(container);
    scheduleFit();

    void initializeTerminalPaneTransport(connectionControlsOptions);

    return () => {
      cleanupTerminalPaneLifecycle({
        clearReconnectTimer,
        container,
        contextMenuHandler,
        dataDisposable,
        fitAddon,
        fitAddonRef,
        fitFrameId,
        markDisposed: () => {
          disposed = true;
        },
        observer,
        selectionDisposable,
        socketRef,
        terminal,
        terminalRef,
      });
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
