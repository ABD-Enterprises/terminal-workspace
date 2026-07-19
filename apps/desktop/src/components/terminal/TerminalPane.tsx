import { FitAddon } from "@xterm/addon-fit";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
import { buildMockCommandResponse, buildTerminalIntro, formatPrompt } from "../../lib/terminal";
import {
  detectSystemColorScheme,
  resolveTerminalTheme,
  type TerminalAnsiPalette,
  type TerminalThemeMode,
} from "../../lib/terminal-themes";
import { classifySshError } from "../../lib/ssh-error-classifier";
import { findMatchesInBuffer, type SearchMatch } from "../../lib/terminal-search";
import { cn, formatHostAddress } from "../../lib/utils";
import { useAppStore } from "../../store/app-store";
import { useKnownHostsStore } from "../../store/known-hosts-store";
import { useSessionsStore } from "../../store/sessions-store";
import { formatHostProtocol, hostSupportsTrustedKeys, type HostRecord } from "../../types/host";
import {
  formatSessionConnectionState,
  type SessionPane,
  type SessionTransport,
} from "../../types/session";

interface TerminalPaneProps {
  host: HostRecord;
  pane: SessionPane;
  active: boolean;
  onActivate: () => void;
  onSplit: () => void;
  onClose: () => void;
}


interface PrivateViewport {
  __termsnipGuarded?: boolean;
  _coreBrowserService?: {
    window: Window;
  };
  _innerRefresh?: () => void;
  _refreshAnimationFrame?: number | null;
  _renderService?: {
    _renderer?: {
      value?: unknown;
    };
  };
}

function getPrivateViewport(terminal: Terminal) {
  return (terminal as Terminal & { _core?: { viewport?: PrivateViewport } })._core?.viewport;
}

function clearViewportRefreshFrame(viewport?: PrivateViewport) {
  if (viewport?._refreshAnimationFrame == null) {
    return;
  }

  viewport._coreBrowserService?.window.cancelAnimationFrame(viewport._refreshAnimationFrame);
  viewport._refreshAnimationFrame = null;
}

function guardViewportRefresh(terminal: Terminal) {
  const viewport = getPrivateViewport(terminal);
  if (!viewport || viewport.__termsnipGuarded || typeof viewport._innerRefresh !== "function") {
    return;
  }

  const originalInnerRefresh = viewport._innerRefresh.bind(viewport);
  viewport._innerRefresh = () => {
    if (!viewport._renderService?._renderer?.value) {
      clearViewportRefreshFrame(viewport);
      return;
    }

    originalInnerRefresh();
  };
  viewport.__termsnipGuarded = true;
}

const stateStyles = {
  connecting: "border-amber-400/50 bg-amber-400/10 text-amber-100",
  connected: "border-emerald-400/50 bg-emerald-400/10 text-emerald-100",
  pendingSecrets: "border-cyan-400/50 bg-cyan-400/10 text-cyan-100",
  disconnected: "border-slate-700 bg-slate-950/80 text-slate-300",
  error: "border-rose-400/50 bg-rose-400/10 text-rose-100",
} as const;

export function TerminalPane({ host, pane, active, onActivate, onSplit, onClose }: TerminalPaneProps) {
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
  const setPaneState = useSessionsStore((state) => state.setPaneState);
  const setPaneReconnectOnRestore = useSessionsStore((state) => state.setPaneReconnectOnRestore);
  const setPanePersistOutputPreview = useSessionsStore(
    (state) => state.setPanePersistOutputPreview
  );
  const setPaneTransport = useSessionsStore((state) => state.setPaneTransport);
  const setPaneBackendSession = useSessionsStore((state) => state.setPaneBackendSession);
  const consumePaneCommand = useSessionsStore((state) => state.consumePaneCommand);
  const recordPaneCommand = useSessionsStore((state) => state.recordPaneCommand);
  const appendCommandOutput = useSessionsStore((state) => state.appendCommandOutput);
  const knownHosts = useKnownHostsStore((state) => state.knownHosts);
  const demoModeEnabled = useAppStore((state) => state.demoModeEnabled);
  const terminalThemeName = useAppStore((state) => state.terminalTheme);

  // Track the OS color-scheme preference and update it when the user toggles
  // dark/light mode at the OS level. We re-resolve the active palette on
  // every change so an "auto" theme follows the system without needing a
  // restart. State stored in component scope so the layout effect's reads
  // are stable. See parity-and-hardening-plan.md P1-UX7.
  const [systemColorScheme, setSystemColorScheme] = useState<TerminalThemeMode>(() =>
    detectSystemColorScheme()
  );
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }
    const query = window.matchMedia("(prefers-color-scheme: light)");
    const handler = (event: MediaQueryListEvent) => {
      setSystemColorScheme(event.matches ? "light" : "dark");
    };
    // addEventListener is the modern API; older Safari only had addListener.
    if (typeof query.addEventListener === "function") {
      query.addEventListener("change", handler);
      return () => query.removeEventListener("change", handler);
    }
    query.addListener(handler);
    return () => query.removeListener(handler);
  }, []);

  const resolvedTerminalPalette: TerminalAnsiPalette = useMemo(
    () => resolveTerminalTheme(terminalThemeName, systemColorScheme).entry.palette,
    [terminalThemeName, systemColorScheme]
  );
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
  // Refs let the xterm custom-key handler call into the latest React state
  // setters without needing to re-attach the handler on every render.
  const setSearchOpenRef = useRef(setSearchOpen);
  setSearchOpenRef.current = setSearchOpen;
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
          tags,
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
        hasReusableBackendSession || !requiresSecrets || (await canRestoreSessionWithoutPrompt(host));

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
            host,
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
                  environment,
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
        setSearchOpenRef.current(true);
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
          (await canRestoreSessionWithoutPrompt(host))
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
    environment,
    group,
    host,
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
    tags,
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

  return (
    <section
      className={cn(
        "flex min-h-[280px] min-w-0 flex-col rounded-[28px] border bg-slate-950/70 transition",
        active ? "border-emerald-400/50 shadow-lg shadow-emerald-950/20" : "border-slate-800/80"
      )}
      onClick={onActivate}
    >
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/80 px-4 py-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-slate-100">{host.label}</p>
          <p className="truncate text-xs text-slate-500">
            {formatHostAddress(host)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={cn(
              "rounded-full border px-2.5 py-1 text-[11px] uppercase tracking-[0.18em]",
              stateStyles[pane.connectionState]
            )}
          >
            {pane.transport}
            {" · "}
            {formatSessionConnectionState(pane.connectionState)}
          </span>
          <label
            className={cn(
              "flex items-center gap-2 rounded-2xl border px-3 py-1.5 text-xs transition",
              pane.persistOutputPreview
                ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-100"
                : "border-slate-700 text-slate-300"
            )}
            onClick={(event) => {
              event.stopPropagation();
            }}
          >
            <input
              type="checkbox"
              checked={pane.persistOutputPreview}
              onChange={(event) => {
                event.stopPropagation();
                setPanePersistOutputPreview(pane.id, event.target.checked);
              }}
              className="h-3.5 w-3.5 rounded border-slate-600 bg-slate-950 accent-emerald-400"
            />
            Save previews
          </label>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              toggleConnectionRef.current();
            }}
            className="rounded-2xl border border-slate-700 px-3 py-1.5 text-xs text-slate-200 transition hover:border-slate-500 hover:text-white"
          >
            {pane.connectionState === "connected"
              ? "Disconnect"
              : pane.connectionState === "pendingSecrets"
                ? "Resume"
                : "Reconnect"}
          </button>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onSplit();
            }}
            className="rounded-2xl border border-slate-700 px-3 py-1.5 text-xs text-slate-200 transition hover:border-slate-500 hover:text-white"
          >
            Split
          </button>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onClose();
            }}
            className="rounded-2xl border border-rose-500/40 px-3 py-1.5 text-xs text-rose-200 transition hover:border-rose-400 hover:text-white"
          >
            Close
          </button>
        </div>
      </header>
      {runtimeStatusMessage && !runtimeStatusMessage.available ? (
        <div className="border-b border-rose-400/20 bg-rose-400/10 px-4 py-2 text-xs text-rose-100">
          <p>{runtimeStatusMessage.message}</p>
          {runtimeStatusMessage.installHint ? (
            <p className="mt-1 text-rose-100/80">{runtimeStatusMessage.installHint}</p>
          ) : null}
        </div>
      ) : null}
      <div className="relative min-h-0 flex-1">
        <div ref={containerRef} className="absolute inset-0 px-3 py-3" />
        {searchOpen ? (
          <div
            className="absolute right-3 top-3 z-10 flex items-center gap-2 rounded-2xl border border-slate-700 bg-slate-950/95 px-3 py-2 shadow-lg shadow-slate-950/40 backdrop-blur"
            onClick={(event) => event.stopPropagation()}
          >
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  closeSearch();
                  return;
                }
                if (event.key === "Enter") {
                  event.preventDefault();
                  advanceSearchMatch(event.shiftKey ? -1 : 1);
                  return;
                }
                if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "g") {
                  event.preventDefault();
                  advanceSearchMatch(event.shiftKey ? -1 : 1);
                }
              }}
              placeholder="Find in scrollback"
              aria-label="Find in terminal scrollback"
              className="w-56 rounded-lg border border-slate-700 bg-slate-900/80 px-2 py-1 text-sm text-slate-100 outline-none transition focus:border-emerald-400/60"
            />
            <span className="min-w-[60px] text-center text-[11px] tabular-nums text-slate-400">
              {searchQuery
                ? searchMatches.length === 0
                  ? "no match"
                  : `${searchActiveIndex + 1}/${searchMatches.length}`
                : "—"}
            </span>
            <button
              type="button"
              onClick={() => advanceSearchMatch(-1)}
              disabled={searchMatches.length === 0}
              title="Previous match (Shift+Enter or ⇧⌘G)"
              aria-label="Previous match"
              className="rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-200 transition hover:border-slate-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              ↑
            </button>
            <button
              type="button"
              onClick={() => advanceSearchMatch(1)}
              disabled={searchMatches.length === 0}
              title="Next match (Enter or ⌘G)"
              aria-label="Next match"
              className="rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-200 transition hover:border-slate-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              ↓
            </button>
            <button
              type="button"
              onClick={() => setSearchCaseSensitive((value) => !value)}
              title={searchCaseSensitive ? "Case-sensitive (click to disable)" : "Case-insensitive (click to enable)"}
              aria-label="Toggle case sensitivity"
              aria-pressed={searchCaseSensitive}
              className={cn(
                "rounded-md border px-2 py-1 text-xs transition",
                searchCaseSensitive
                  ? "border-emerald-400/60 bg-emerald-400/10 text-emerald-100"
                  : "border-slate-700 text-slate-300 hover:border-slate-500 hover:text-white"
              )}
            >
              Aa
            </button>
            <button
              type="button"
              onClick={closeSearch}
              title="Close search (Esc)"
              aria-label="Close search"
              className="rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-200 transition hover:border-slate-500 hover:text-white"
            >
              ✕
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
}
