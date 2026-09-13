import { FitAddon } from "@xterm/addon-fit";
import { useEffect, useMemo, useRef } from "react";
import { Terminal } from "xterm";
import "xterm/css/xterm.css";
import { type SessionSocketLike } from "../../lib/api";
import { isTauriRuntime } from "../../lib/backend-runtime";
import { findKnownHostMatch } from "../../lib/connections";
import { terminalEnvironmentKey, terminalTagsKey } from "../../lib/terminal";
import { type TerminalAnsiPalette } from "../../lib/terminal-themes";
import { useAppStore } from "../../store/app-store";
import { useKnownHostsStore } from "../../store/known-hosts-store";
import { useSessionsStore } from "../../store/sessions-store";
import { formatHostProtocol, hostSupportsTrustedKeys, type HostRecord } from "../../types/host";
import { type SessionPane, type SessionTransport } from "../../types/session";

import { useTerminalPaneLifecycle } from "./use-terminal-pane-lifecycle";
import { useTerminalPaneQueuedCommands } from "./use-terminal-pane-queued-commands";
import { useTerminalPaneRuntimeStatus } from "./use-terminal-pane-runtime-status";
import { useTerminalPaneSearch } from "./use-terminal-pane-search";

interface UseTerminalPaneSessionOptions {
  host: HostRecord;
  pane: SessionPane;
  resolvedTerminalPalette: TerminalAnsiPalette;
}

export function useTerminalPaneSession({ host, pane, resolvedTerminalPalette }: UseTerminalPaneSessionOptions) {
  const {
    agentForwarding,
    authMethod,
    environment,
    group,
    hostKeyPolicy,
    hostname,
    id,
    label,
    port,
    privateKeyPath,
    protocol,
    sftpRoot,
    tags,
    username,
  } =
    host;

  /*
   * #175: the terminal-owning effect below is torn down and rebuilt whenever any
   * of its deps change identity — and hosts-store rebuilds EVERY host object on
   * any mutation (markHostConnectedInCollection -> sortHostCollection ->
   * map(normalizeHostRecord)). So running a snippet on one host disposed the
   * xterm and closed the socket on every open terminal: scrollback gone, intro
   * reprinted, all sockets flapping.
   *
   * The primitive fields above are value-compared by React and are fine. These
   * two are objects, so they churn on every rebuild even when their contents are
   * identical. Re-memoizing them against a serialized value keeps the effect's
   * dependency honest — a real environment or tag change still changes the key
   * and still recreates the terminal, which is the behaviour we must not lose.
   *
   * Environment keys are sorted so key order cannot fake a change; tag ORDER is
   * significant (buildMockCommandResponse renders it), so tags are not sorted.
   */
  const environmentKey = terminalEnvironmentKey(environment);
  const tagsKey = terminalTagsKey(tags);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by value on purpose
  const stableEnvironment = useMemo(() => environment, [environmentKey]);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by value on purpose
  const stableTags = useMemo(() => tags, [tagsKey]);

  const setPaneState = useSessionsStore((state) => state.setPaneState);
  const setPaneReconnectOnRestore = useSessionsStore((state) => state.setPaneReconnectOnRestore);
  const setPaneTransport = useSessionsStore((state) => state.setPaneTransport);
  const setPaneBackendSession = useSessionsStore((state) => state.setPaneBackendSession);
  const consumePaneCommand = useSessionsStore((state) => state.consumePaneCommand);
  const recordPaneCommand = useSessionsStore((state) => state.recordPaneCommand);
  const appendCommandOutput = useSessionsStore((state) => state.appendCommandOutput);
  const knownHosts = useKnownHostsStore((state) => state.knownHosts);
  const demoModeEnabled = useAppStore((state) => state.demoModeEnabled);

  // Refs that the layout effect reads when constructing the terminal. We do
  // NOT include the resolved palette in the layout-effect dep list because
  // recreating the terminal on every theme tweak would lose scrollback and
  // tear down the live SSH stream. Instead a separate effect (below) hot-
  // applies palette changes via `terminal.options.theme = …`.
  const initialPaletteRef = useRef(resolvedTerminalPalette);

  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);

  const socketRef = useRef<SessionSocketLike | null>(null);
  const commandBufferRef = useRef("");
  const transportRef = useRef<SessionTransport>(pane.transport);
  const connectionStateRef = useRef(pane.connectionState);
  const backendSessionIdRef = useRef<string | undefined>(pane.backendSessionId);
  const connectingRef = useRef(false);
  const connectedOnceRef = useRef(pane.connectionState === "connected");
  const reconnectOnRestoreRef = useRef(pane.reconnectOnRestore);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const reconnectAttemptRef = useRef(0);
  const intentionalDisconnectRef = useRef(false);
  const pendingSecretsNoticeShownRef = useRef(false);
  const toggleConnectionRef = useRef<() => void>(() => undefined);
  const ensureConnectedRef = useRef<() => void>(() => undefined);
  const dispatchCommandRef = useRef<(command: string) => void>(() => undefined);
  const activeHistoryEntryIdRef = useRef<string | undefined>(undefined);
  const processedCommandIdRef = useRef<string | undefined>(undefined);
  const { runtimeStatusMessage, runtimeStatusRef, setRuntimeStatusMessage } = useTerminalPaneRuntimeStatus(protocol);
  const {
    advanceSearchMatch,
    closeSearch,
    searchActiveIndex,
    searchCaseSensitive,
    searchInputRef,
    searchMatches,
    searchOpen,
    searchQuery,
    setSearchCaseSensitive,
    setSearchOpen,
    setSearchQuery,
  } = useTerminalPaneSearch({ terminalRef });

  const trustedKnownHost = useMemo(
    () =>
      hostSupportsTrustedKeys(protocol)
        ? findKnownHostMatch(knownHosts, { hostname, port })
        : undefined,
    [hostname, knownHosts, port, protocol]
  );
  const useMockTransport = demoModeEnabled || (protocol === "ssh" && authMethod === "none");
  const unsupportedTransport =
    !demoModeEnabled &&
    (protocol === "localShell" ||
      protocol === "telnet" ||
      protocol === "serial" ||
      protocol === "mosh") &&
    !isTauriRuntime();
  const nativeBridgeEnabled = !useMockTransport && !unsupportedTransport && isTauriRuntime();
  const protocolLabel = formatHostProtocol(protocol);

  useEffect(() => {
    transportRef.current = pane.transport;
    connectionStateRef.current = pane.connectionState;
    backendSessionIdRef.current = pane.backendSessionId;
    reconnectOnRestoreRef.current = pane.reconnectOnRestore;
  }, [pane.backendSessionId, pane.connectionState, pane.reconnectOnRestore, pane.transport]);

  // Hot-apply terminal theme changes without recreating the terminal. Updating
  // `terminal.options.theme` is the supported xterm.js path for live theme
  // swaps and preserves scrollback + the underlying SSH session.
  // See parity-and-hardening-plan.md P1-UX7.
  useEffect(() => {
    initialPaletteRef.current = resolvedTerminalPalette;
    const terminal = terminalRef.current;
    if (!terminal) {
      return;
    }
    terminal.options.theme = resolvedTerminalPalette;
  }, [resolvedTerminalPalette]);

  useTerminalPaneLifecycle({
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
  });

  useTerminalPaneQueuedCommands({
    consumePaneCommand,
    dispatchCommandRef,
    ensureConnectedRef,
    pane,
    processedCommandIdRef,
    socketRef,
  });

  return { advanceSearchMatch, closeSearch, containerRef, runtimeStatusMessage, searchActiveIndex, searchCaseSensitive, searchInputRef, searchMatches, searchOpen, searchQuery, setSearchCaseSensitive, setSearchQuery, terminalRef, toggleConnectionRef };
}
