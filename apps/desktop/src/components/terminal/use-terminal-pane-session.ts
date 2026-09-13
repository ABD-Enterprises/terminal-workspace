import { FitAddon } from "@xterm/addon-fit";
import { useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Terminal } from "xterm";
import "xterm/css/xterm.css";
import {
  closeBackendSession,
  createBackendSession,
  getProtocolRuntimeStatus,
  openBackendSessionSocket,
  resizeBackendSession,
  type SessionSocketLike,
} from "../../lib/api";
import { isTauriRuntime, parseSessionFrame } from "../../lib/backend-runtime";
import { buildBackendConnectionFromKnownHost, findKnownHostMatch } from "../../lib/connections";
import { canRestoreSessionWithoutPrompt, ensureRuntimeSecrets } from "../../lib/runtime-secrets";
import {
  buildMockCommandResponse,
  buildTerminalIntro,
  formatPrompt,
  terminalEnvironmentKey,
  terminalTagsKey,
} from "../../lib/terminal";
import { type TerminalAnsiPalette } from "../../lib/terminal-themes";
import { classifySshError } from "../../lib/ssh-error-classifier";
import { findMatchesInBuffer, type SearchMatch } from "../../lib/terminal-search";
import { useAppStore } from "../../store/app-store";
import { useKnownHostsStore } from "../../store/known-hosts-store";
import { useSessionsStore } from "../../store/sessions-store";
import { formatHostProtocol, hostSupportsTrustedKeys, type HostRecord } from "../../types/host";
import { type SessionPane, type SessionTransport } from "../../types/session";

import { clearViewportRefreshFrame, getPrivateViewport, guardViewportRefresh } from "./terminal-pane-viewport";

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

  // ---- In-pane search-in-scrollback (Cmd+F) ------------------------------
  // We do not depend on @xterm/addon-search here because it is not in the
  // local pnpm offline cache and adding it would require network. Instead
  // we drive xterm's own buffer + selection APIs directly. See
  // parity-and-hardening-plan.md P1-UX6.
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchCaseSensitive, setSearchCaseSensitive] = useState(false);
  const [searchMatches, setSearchMatches] = useState<SearchMatch[]>([]);
  const [searchActiveIndex, setSearchActiveIndex] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);
  // #257: this used to be a `setSearchOpenRef` whose `.current` was assigned
  // during render, so the xterm custom-key handler could reach the "latest"
  // setter without re-attaching. React guarantees a useState setter's identity
  // is stable for the lifetime of the component, so the ref never held anything
  // but the same function — it bought nothing and cost a ref write during
  // render, which is what react-hooks/refs flags. The handler closes over
  // setSearchOpen directly now.
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
  const runtimeStatusRef = useRef<{
    available: boolean;
    installHint?: string;
    message: string;
  } | null>(null);
  const toggleConnectionRef = useRef<() => void>(() => undefined);
  const ensureConnectedRef = useRef<() => void>(() => undefined);
  const dispatchCommandRef = useRef<(command: string) => void>(() => undefined);
  const activeHistoryEntryIdRef = useRef<string | undefined>(undefined);
  const processedCommandIdRef = useRef<string | undefined>(undefined);
  const [runtimeStatusMessage, setRuntimeStatusMessage] = useState<{
    available: boolean;
    installHint?: string;
    message: string;
  } | null>(null);
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
    let cancelled = false;

    void getProtocolRuntimeStatus(protocol).then((status) => {
      if (cancelled) {
        return;
      }

      const nextStatus = {
        available: status.available,
        installHint: status.installHint,
        message: status.message,
      };
      runtimeStatusRef.current = nextStatus;
      setRuntimeStatusMessage(nextStatus);
    });

    return () => {
      cancelled = true;
    };
  }, [protocol]);

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

  // ---- Search effects ----------------------------------------------------
  // Recompute matches when the query or case sensitivity changes, and reset
  // the active index so the highlight starts at the first match. Empty
  // query → no matches (clearSelection runs in the navigation effect).
  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal || !searchOpen) {
      return;
    }
    const matches = findMatchesInBuffer(
      terminal.buffer.active,
      searchQuery,
      searchCaseSensitive
    );
    setSearchMatches(matches);
    setSearchActiveIndex(0);
  }, [searchOpen, searchQuery, searchCaseSensitive]);

  // Move the viewport + selection to the active match. clearSelection on an
  // empty match list keeps stale highlighting from previous queries from
  // sticking around.
  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal || !searchOpen) {
      return;
    }
    if (searchMatches.length === 0) {
      terminal.clearSelection();
      return;
    }
    const safeIndex = Math.min(Math.max(0, searchActiveIndex), searchMatches.length - 1);
    const match = searchMatches[safeIndex];
    // scrollToLine wants a row index relative to the buffer's baseY; if the
    // match is in scrollback above baseY, the same row index brings it on-
    // screen because the viewport is positioned by row.
    terminal.scrollToLine(match.row);
    terminal.select(match.col, match.row, match.length);
  }, [searchActiveIndex, searchMatches, searchOpen]);

  // Focus the search input as soon as the overlay opens.
  useEffect(() => {
    if (searchOpen) {
      // Defer to next frame so the input is in the DOM before .focus().
      const id = window.requestAnimationFrame(() => {
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      });
      return () => window.cancelAnimationFrame(id);
    }
    // Closing — clean up any leftover selection so it does not bleed into
    // a non-search interaction.
    terminalRef.current?.clearSelection();
  }, [searchOpen]);

  const advanceSearchMatch = (direction: 1 | -1) => {
    setSearchActiveIndex((current) => {
      if (searchMatches.length === 0) {
        return 0;
      }
      const next = (current + direction + searchMatches.length) % searchMatches.length;
      return next;
    });
  };

  const closeSearch = () => {
    setSearchOpen(false);
    setSearchQuery("");
    setSearchMatches([]);
    setSearchActiveIndex(0);
  };

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
      transportRef.current =
        protocol === "localShell"
          ? "localShell"
          : protocol === "telnet"
            ? "telnet"
            : protocol === "serial"
              ? "serial"
              : protocol === "mosh"
                ? "mosh"
                : "ssh";
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

  useEffect(() => {
    const queuedCommand = pane.queuedCommands[0];

    if (!queuedCommand) {
      processedCommandIdRef.current = undefined;
      return;
    }

    if (processedCommandIdRef.current === queuedCommand.id) {
      return;
    }

    const sshTransportPending =
      pane.transport !== "mock" &&
      pane.transport !== "unsupported" &&
      socketRef.current?.readyState !== WebSocket.OPEN;

    if (pane.connectionState !== "connected" || sshTransportPending) {
      ensureConnectedRef.current();
      return;
    }

    processedCommandIdRef.current = queuedCommand.id;
    dispatchCommandRef.current(queuedCommand.command);
    consumePaneCommand(pane.id, queuedCommand.id);
  }, [consumePaneCommand, pane.connectionState, pane.id, pane.queuedCommands, pane.transport]);


  return { advanceSearchMatch, closeSearch, containerRef, runtimeStatusMessage, searchActiveIndex, searchCaseSensitive, searchInputRef, searchMatches, searchOpen, searchQuery, setSearchCaseSensitive, setSearchQuery, terminalRef, toggleConnectionRef };
}
