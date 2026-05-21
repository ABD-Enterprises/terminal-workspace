import { useEffect, useRef, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAppShellTheme } from "../../hooks/useAppShellTheme";
import { useCommandPalette } from "../../hooks/useCommandPalette";
import { useKeyboardCheatsheet } from "../../hooks/useKeyboardCheatsheet";
import { KeyboardCheatsheet } from "../common/KeyboardCheatsheet";
import { FirstRunTour } from "../common/FirstRunTour";
import { isTauriRuntime } from "../../lib/backend-runtime";
import { launchHostSession as sharedLaunchHostSession } from "../../lib/launch-host-session";
import { navigationItems } from "../../lib/navigation";
import { scorePaletteMatch } from "../../lib/palette-score";
import { formatPrimaryShortcut, isPrimaryShortcut } from "../../lib/shortcuts";
import { cn, formatHostAddress } from "../../lib/utils";
import { useAppStore } from "../../store/app-store";
import { applyHostFilters, useHostsStore } from "../../store/hosts-store";
import { useSessionsStore } from "../../store/sessions-store";
import { useSnippetsStore } from "../../store/snippets-store";
import { useTransfersStore } from "../../store/transfers-store";
import { formatHostProtocol, hostSupportsSftp, hostSupportsTrustedKeys } from "../../types/host";
import { SessionRestoreManager } from "../terminal/SessionRestoreManager";
import { Sidebar } from "./Sidebar";

const APP_TITLE = "term-snip";

export function AppShell() {
  useAppShellTheme();
  useCommandPalette();
  useKeyboardCheatsheet();

  const location = useLocation();
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [paletteQuery, setPaletteQuery] = useState("");
  const [paletteSelectedIndex, setPaletteSelectedIndex] = useState(0);
  const hosts = useHostsStore((state) => state.hosts);
  const markConnected = useHostsStore((state) => state.markConnected);
  const sessionTabs = useSessionsStore((state) => state.tabs);
  const sessionPanes = useSessionsStore((state) => state.panes);
  const activeSessionTabId = useSessionsStore((state) => state.activeTabId);
  const queuePaneCommand = useSessionsStore((state) => state.queuePaneCommand);
  const selectSessionTab = useSessionsStore((state) => state.selectTab);
  const closeTab = useSessionsStore((state) => state.closeTab);
  const duplicateSession = useSessionsStore((state) => state.duplicateSession);
  const splitTab = useSessionsStore((state) => state.splitTab);
  const setSplitDirection = useSessionsStore((state) => state.setSplitDirection);
  const snippets = useSnippetsStore((state) => state.snippets);
  const markSnippetRun = useSnippetsStore((state) => state.markSnippetRun);
  const setActiveTransferHost = useTransfersStore((state) => state.setActiveHost);
  const activeItem =
    navigationItems.find((item) => location.pathname.startsWith(item.path)) ?? navigationItems[0];
  const commandPaletteOpen = useAppStore((state) => state.commandPaletteOpen);
  const openCommandPalette = useAppStore((state) => state.openCommandPalette);
  const closeCommandPalette = useAppStore((state) => state.closeCommandPalette);
  const setSidebarSearch = useAppStore((state) => state.setSidebarSearch);
  const workspaceDensity = useAppStore((state) => state.workspaceDensity);
  const sectionShortcutsEnabled = useAppStore((state) => state.sectionShortcutsEnabled);
  const activeSessionTab = sessionTabs.find((tab) => tab.id === activeSessionTabId) ?? sessionTabs[0];
  const activeSessionPane = activeSessionTab
    ? sessionPanes[activeSessionTab.activePaneId]
    : undefined;

  const focusSessionTab = (tabId: string, replace = false) => {
    selectSessionTab(tabId);
    setPaletteQuery("");
    navigate(`/sessions?tabId=${tabId}`, replace ? { replace: true } : undefined);
    closeCommandPalette();
  };

  useEffect(() => {
    if (commandPaletteOpen) {
      inputRef.current?.focus();
      setPaletteSelectedIndex(0);
    }
  }, [commandPaletteOpen]);

  // Reset selection when the result set changes so the highlight never points
  // at a row that no longer exists.
  useEffect(() => {
    setPaletteSelectedIndex(0);
  }, [paletteQuery]);

  // ---- Native menu wiring -------------------------------------------------
  // The macOS application menu emits `termsnip://menu-event` with a string
  // payload like "menu:nav-hosts". We translate each id into the same actions
  // that the in-app keyboard / palette already wire up. Browser preview has
  // no native menu, so this listener simply does not fire.
  // See parity-and-hardening-plan.md P1-UX4.
  const setWorkspaceDensity = useAppStore((state) => state.setWorkspaceDensity);
  useEffect(() => {
    if (!isTauriRuntime()) {
      return;
    }
    let unlistenFn: (() => void) | undefined;
    let cancelled = false;

    const dispatchMenu = (id: string) => {
      switch (id) {
        case "menu:settings":
        case "menu:nav-settings":
          navigate("/settings");
          break;
        case "menu:nav-hosts":
          navigate("/hosts");
          break;
        case "menu:nav-sessions":
          navigate("/sessions");
          break;
        case "menu:nav-snippets":
          navigate("/snippets");
          break;
        case "menu:nav-keys":
          navigate("/keys");
          break;
        case "menu:nav-transfers":
          navigate("/transfers");
          break;
        case "menu:command-palette":
          openCommandPalette();
          break;
        case "menu:toggle-density":
          setWorkspaceDensity(workspaceDensity === "compact" ? "comfortable" : "compact");
          break;
        case "menu:next-tab":
        case "menu:prev-tab": {
          if (sessionTabs.length === 0) {
            break;
          }
          const currentIndex = sessionTabs.findIndex((tab) => tab.id === activeSessionTabId);
          const startIndex = currentIndex >= 0 ? currentIndex : 0;
          const direction = id === "menu:prev-tab" ? -1 : 1;
          const nextIndex =
            (startIndex + direction + sessionTabs.length) % sessionTabs.length;
          const nextTabId = sessionTabs[nextIndex]?.id;
          if (nextTabId) {
            selectSessionTab(nextTabId);
            navigate(`/sessions?tabId=${nextTabId}`, { replace: true });
          }
          break;
        }
        case "menu:new-tab":
          // Open the palette so the user can type-to-connect. There is no
          // single canonical "new tab" action in this app — every tab is
          // bound to a host record.
          openCommandPalette();
          navigate("/sessions");
          break;
        case "menu:duplicate-tab": {
          if (!activeSessionTab) {
            break;
          }
          const host = hosts.find((entry) => entry.id === activeSessionTab.hostId);
          if (host) {
            duplicateSession(host, host.label);
            navigate(`/sessions?tabId=${activeSessionTab.id}`);
          }
          break;
        }
        case "menu:close-tab": {
          if (activeSessionTab) {
            closeTab(activeSessionTab.id);
          }
          break;
        }
        case "menu:import-ssh-config":
          // Routes the user to Hosts where the import button lives. A dedicated
          // imperative trigger is queued for P2.
          navigate("/hosts");
          break;
        case "menu:help":
          // No bundled docs yet; leave a console crumb so the menu item is
          // discoverable but does not silently no-op without explanation.
          // P2 ticket: ship offline help bundle.
          console.info("[termsnip] menu:help — docs site not yet wired");
          break;
        default:
          // Unknown ids should be a no-op (forwards-compat for new menu
          // items added on the Rust side before the renderer learns about
          // them). Log only, do not throw.
          console.warn(`[termsnip] unhandled menu id: ${id}`);
      }
    };

    void import("@tauri-apps/api/event")
      .then(({ listen }) =>
        listen<string>("termsnip://menu-event", (event) => {
          dispatchMenu(event.payload);
        })
      )
      .then((unlisten) => {
        if (cancelled) {
          unlisten();
          return;
        }
        unlistenFn = unlisten;
      })
      .catch(() => {
        // Tauri event API not available (browser preview) — listener silently
        // disabled.
      });

    return () => {
      cancelled = true;
      unlistenFn?.();
    };
  }, [
    activeSessionTab,
    activeSessionTabId,
    closeTab,
    duplicateSession,
    hosts,
    navigate,
    openCommandPalette,
    selectSessionTab,
    sessionTabs,
    setWorkspaceDensity,
    workspaceDensity,
  ]);

  // Bind the macOS window title to the active session so the dock / Mission
  // Control / Cmd-Tab labels reflect what the user is currently looking at.
  // Falls back to the app name when there is no active session, and degrades
  // to document.title in the browser preview path. See parity-and-hardening
  // review §4.7.
  const activeSessionHostForTitle = (() => {
    const tab = sessionTabs.find((entry) => entry.id === activeSessionTabId) ?? sessionTabs[0];
    if (!tab) {
      return undefined;
    }
    return hosts.find((entry) => entry.id === tab.hostId);
  })();
  useEffect(() => {
    const nextTitle = activeSessionHostForTitle
      ? `${APP_TITLE} — ${activeSessionHostForTitle.label} (${formatHostProtocol(activeSessionHostForTitle.protocol)})`
      : APP_TITLE;

    document.title = nextTitle;

    if (!isTauriRuntime()) {
      return;
    }
    let cancelled = false;
    void import("@tauri-apps/api/window")
      .then(({ getCurrentWindow }) => {
        if (cancelled) {
          return;
        }
        return getCurrentWindow().setTitle(nextTitle);
      })
      .catch(() => {
        // Ignore — the window may have been closed between effect schedule
        // and resolve, or the build may not have the window plugin enabled.
      });
    return () => {
      cancelled = true;
    };
  }, [activeSessionHostForTitle]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const eventTarget = event.target;
      const targetIsEditable =
        eventTarget instanceof HTMLElement &&
        (eventTarget instanceof HTMLInputElement ||
          eventTarget instanceof HTMLTextAreaElement ||
          eventTarget.isContentEditable ||
          eventTarget.getAttribute("role") === "textbox");

      if (targetIsEditable) {
        return;
      }

      if (isPrimaryShortcut(event, "tab") && sessionTabs.length > 1) {
        event.preventDefault();
        const currentIndex = sessionTabs.findIndex((tab) => tab.id === activeSessionTabId);
        const startIndex = currentIndex >= 0 ? currentIndex : 0;
        const direction = event.shiftKey ? -1 : 1;
        const nextIndex = (startIndex + direction + sessionTabs.length) % sessionTabs.length;
        const nextTabId = sessionTabs[nextIndex]?.id;

        if (nextTabId) {
          selectSessionTab(nextTabId);
          setPaletteQuery("");
          navigate(`/sessions?tabId=${nextTabId}`, { replace: true });
          closeCommandPalette();
        }
        return;
      }

      if (!sectionShortcutsEnabled) {
        return;
      }

      const nextIndex = navigationItems.findIndex((_, index) =>
        isPrimaryShortcut(event, String(index + 1))
      );
      if (nextIndex === -1) {
        return;
      }

      event.preventDefault();
      setPaletteQuery("");
      closeCommandPalette();
      navigate(navigationItems[nextIndex].path);
    };

    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [
    activeSessionTabId,
    closeCommandPalette,
    navigate,
    sectionShortcutsEnabled,
    selectSessionTab,
    sessionTabs,
  ]);

  // T09: fuzzy + acronym match. We score each candidate's combined
  // haystack against the query and sort high-score-first. Empty query
  // shows everything in its natural order.
  const trimmedQuery = paletteQuery.trim();

  const matchingSections = trimmedQuery
    ? navigationItems
        .map((item) => ({
          item,
          score: scorePaletteMatch(trimmedQuery, `${item.label} ${item.description}`),
        }))
        .filter(({ score }) => score > 0)
        .sort((left, right) => right.score - left.score)
        .map(({ item }) => item)
    : navigationItems;

  const matchingHosts = applyHostFilters(hosts, {
    query: paletteQuery,
    activeGroup: "all",
    activeTag: "all",
    favoritesOnly: false,
  }).slice(0, 6);
  const matchingSessionTabs = trimmedQuery
    ? sessionTabs
        .map((tab) => {
          const host = hosts.find((entry) => entry.id === tab.hostId);
          const haystack = `${tab.title} ${host?.label ?? ""} ${host?.hostname ?? ""} ${host?.username ?? ""}`;
          return { tab, score: scorePaletteMatch(trimmedQuery, haystack) };
        })
        .filter(({ score }) => score > 0)
        .sort((left, right) => right.score - left.score)
        .slice(0, 6)
        .map(({ tab }) => tab)
    : sessionTabs.slice(0, 6);
  const matchingSnippets = trimmedQuery
    ? snippets
        .map((snippet) => {
          const haystack = [
            snippet.title,
            snippet.description,
            snippet.command,
            snippet.tags.join(" "),
          ].join(" ");
          return { snippet, score: scorePaletteMatch(trimmedQuery, haystack) };
        })
        .filter(({ score }) => score > 0)
        .sort((left, right) => right.score - left.score)
        .slice(0, 6)
        .map(({ snippet }) => snippet)
    : snippets.slice(0, 6);

  const focusHost = (hostId: string) => {
    setPaletteQuery("");
    setSidebarSearch("");
    navigate(`/hosts?focus=${hostId}`);
    closeCommandPalette();
  };

  const launchHostSession = async (hostId: string) => {
    const host = hosts.find((entry) => entry.id === hostId);
    if (!host) {
      return;
    }
    const result = await sharedLaunchHostSession(host);
    if (!result.ok || !result.tabId) {
      if (result.errorMessage) {
        console.warn(`[palette] ${result.errorMessage}`);
      }
      return;
    }
    setPaletteQuery("");
    navigate(`/sessions?tabId=${result.tabId}`);
    closeCommandPalette();
  };

  const openHostTransfers = (hostId: string) => {
    setActiveTransferHost(hostId);
    setPaletteQuery("");
    navigate("/transfers");
    closeCommandPalette();
  };

  const manageHostTrust = (hostId: string) => {
    setPaletteQuery("");
    navigate(`/keys?scanHost=${encodeURIComponent(hostId)}&autoScan=1`);
    closeCommandPalette();
  };

  const focusSection = (path: string) => {
    setPaletteQuery("");
    navigate(path);
    closeCommandPalette();
  };

  const focusSession = (tabId: string) => {
    focusSessionTab(tabId);
  };

  const runSnippetInActivePane = (snippetId: string) => {
    const snippet = snippets.find((entry) => entry.id === snippetId);
    if (!snippet) {
      return;
    }

    if (!activeSessionPane || !activeSessionTab) {
      setPaletteQuery("");
      navigate("/snippets");
      closeCommandPalette();
      return;
    }

    queuePaneCommand(activeSessionPane.id, snippet.command, snippet.title);
    markSnippetRun(snippet.id);
    markConnected(activeSessionPane.hostId);
    setPaletteQuery("");
    navigate(`/sessions?tabId=${activeSessionTab.id}`);
    closeCommandPalette();
  };

  // ---- Active-session command surface ---------------------------------------
  // When a session tab is open, expose the commands a power user reaches for
  // most often (split, duplicate, files, close) directly in the palette so
  // they do not require a tab-bar visit. Closes the gap called out in
  // docs/parity-and-hardening-review.md §4.2.
  type ActiveCommand = {
    key: string;
    label: string;
    sublabel: string;
    run: () => void;
  };
  const activeSessionHost = activeSessionPane
    ? hosts.find((entry) => entry.id === activeSessionPane.hostId)
    : undefined;
  const activeSessionCommands: ActiveCommand[] = (() => {
    if (!activeSessionTab || !activeSessionHost) {
      return [];
    }
    const tabId = activeSessionTab.id;
    const host = activeSessionHost;
    return [
      {
        key: "active:duplicate",
        label: "Duplicate this tab",
        sublabel: `Open a second SSH session to ${host.label}`,
        run: () => {
          duplicateSession(host, host.label);
          setPaletteQuery("");
          navigate(`/sessions?tabId=${tabId}`);
          closeCommandPalette();
        },
      },
      {
        key: "active:split-h",
        label: "Split horizontally",
        sublabel: `Add a side-by-side pane for ${host.label}`,
        run: () => {
          setSplitDirection(tabId, "horizontal");
          splitTab(tabId, host);
          setPaletteQuery("");
          navigate(`/sessions?tabId=${tabId}`);
          closeCommandPalette();
        },
      },
      {
        key: "active:split-v",
        label: "Split vertically",
        sublabel: `Stack a new pane below for ${host.label}`,
        run: () => {
          setSplitDirection(tabId, "vertical");
          splitTab(tabId, host);
          setPaletteQuery("");
          navigate(`/sessions?tabId=${tabId}`);
          closeCommandPalette();
        },
      },
      ...(hostSupportsSftp(host.protocol)
        ? [
            {
              key: "active:files",
              label: "Open files (SFTP)",
              sublabel: `Browse the remote filesystem on ${host.hostname}`,
              run: () => openHostTransfers(host.id),
            },
          ]
        : []),
      {
        key: "active:close",
        label: "Close this tab",
        sublabel: `Disconnect and remove "${activeSessionTab.title}"`,
        run: () => {
          closeTab(tabId);
          setPaletteQuery("");
          closeCommandPalette();
        },
      },
    ];
  })();

  const matchingActiveCommands = activeSessionCommands.filter((command) => {
    if (!paletteQuery.trim()) {
      return true;
    }
    const haystack = `${command.label} ${command.sublabel}`.toLowerCase();
    return haystack.includes(paletteQuery.trim().toLowerCase());
  });

  // ---- Recent --------------------------------------------------------------
  const recentSnippet = snippets
    .filter((snippet) => Boolean(snippet.lastRunAt))
    .sort((left, right) => (right.lastRunAt ?? "").localeCompare(left.lastRunAt ?? ""))[0];
  const recentHost = hosts
    .filter((host) => Boolean(host.lastConnectedAt))
    .sort((left, right) =>
      (right.lastConnectedAt ?? "").localeCompare(left.lastConnectedAt ?? "")
    )[0];

  type RecentCommand = ActiveCommand;
  const recentCommands: RecentCommand[] = [
    ...(recentSnippet && activeSessionPane
      ? [
          {
            key: `recent:rerun-${recentSnippet.id}`,
            label: `Rerun: ${recentSnippet.title}`,
            sublabel: "Send the most recently executed snippet to the active pane",
            run: () => runSnippetInActivePane(recentSnippet.id),
          },
        ]
      : []),
    ...(recentHost && (!activeSessionTab || activeSessionTab.hostId !== recentHost.id)
      ? [
          {
            key: `recent:reconnect-${recentHost.id}`,
            label: `Reconnect to ${recentHost.label}`,
            sublabel: `Last connected ${recentHost.lastConnectedAt ?? "recently"}`,
            run: () => launchHostSession(recentHost.id),
          },
        ]
      : []),
  ];

  const matchingRecent = recentCommands.filter((command) => {
    if (!paletteQuery.trim()) {
      return true;
    }
    const haystack = `${command.label} ${command.sublabel}`.toLowerCase();
    return haystack.includes(paletteQuery.trim().toLowerCase());
  });

  // ---- Flat keyboard-nav row list -----------------------------------------
  // All visible row primary-actions in render order. The palette tracks a
  // single `paletteSelectedIndex` into this list so ArrowUp/Down + Enter work
  // across every section without per-section focus management.
  type PaletteRow = { key: string; run: () => void };
  const paletteRows: PaletteRow[] = [
    ...matchingActiveCommands.map((command) => ({ key: command.key, run: command.run })),
    ...matchingRecent.map((command) => ({ key: command.key, run: command.run })),
    ...matchingSections.map((item) => ({ key: `section:${item.path}`, run: () => focusSection(item.path) })),
    ...matchingSessionTabs.map((tab) => ({ key: `session:${tab.id}`, run: () => focusSession(tab.id) })),
    ...matchingHosts.map((host) => ({ key: `host:${host.id}`, run: () => launchHostSession(host.id) })),
    ...matchingSnippets.map((snippet) => ({
      key: `snippet:${snippet.id}`,
      run: () => runSnippetInActivePane(snippet.id),
    })),
  ];
  const clampedSelectedIndex = paletteRows.length
    ? Math.min(paletteSelectedIndex, paletteRows.length - 1)
    : 0;
  const selectedRowKey = paletteRows[clampedSelectedIndex]?.key;

  const isRowSelected = (key: string) => selectedRowKey === key;
  const handleRowEnter = () => {
    paletteRows[clampedSelectedIndex]?.run();
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-transparent text-slate-100">
      <SessionRestoreManager />
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <main
          className={cn(
            "min-h-0 flex-1",
            workspaceDensity === "compact" ? "p-2" : "p-3"
          )}
        >
          <div className="flex h-full min-h-0 flex-col rounded-[20px] border border-slate-800/90 bg-slate-900/60 shadow-2xl shadow-slate-950/40 backdrop-blur-xl">
            <div
              className={cn(
                "flex items-center justify-between gap-3 border-b border-slate-800/90",
                workspaceDensity === "compact" ? "px-3 py-2" : "px-4 py-3"
              )}
            >
              <div className="min-w-0">
                <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                  <h1 className="text-[17px] font-semibold text-slate-50">{activeItem.label}</h1>
                  <p className="truncate text-[11px] text-slate-500">{activeItem.description}</p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {sectionShortcutsEnabled ? (
                  <span className="hidden rounded-full border border-slate-700 bg-slate-950/80 px-2 py-1 text-[10px] uppercase tracking-[0.16em] text-slate-400 sm:inline-flex">
                    {formatPrimaryShortcut("1")} to {formatPrimaryShortcut("6")}
                  </span>
                ) : null}
                <button
                  type="button"
                  onClick={openCommandPalette}
                  className="rounded-lg border border-slate-700 bg-slate-950/80 px-3 py-1.5 text-[12px] text-slate-200 transition hover:border-slate-500 hover:text-white"
                >
                  Command Palette {formatPrimaryShortcut("k")}
                </button>
              </div>
            </div>
            <div
              className={cn(
                "min-h-0 flex-1 overflow-hidden",
                workspaceDensity === "compact" ? "px-3 py-2.5" : "px-4 py-3.5"
              )}
            >
              <Outlet />
            </div>
          </div>
        </main>
      </div>

      {commandPaletteOpen ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-950/70 px-6 py-20 backdrop-blur-sm">
          <button
            type="button"
            aria-label="Close command palette"
            className="absolute inset-0"
            onClick={() => {
              setPaletteQuery("");
              closeCommandPalette();
            }}
          />
          <div className="relative z-10 w-full max-w-3xl rounded-[24px] border border-slate-700/70 bg-slate-900/95 p-3.5 shadow-2xl shadow-slate-950/70">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-emerald-300">
                  Command palette
                </p>
                <p className="mt-1 text-xs text-slate-400">
                  Jump between sections, focus open session tabs, launch hosts directly
                  {sectionShortcutsEnabled ? ", or use `⌘1` through `⌘6`." : "."}
                </p>
              </div>
              <span className="rounded-full border border-slate-700 bg-slate-950/80 px-3 py-1 text-xs text-slate-400">
                {formatPrimaryShortcut("k")}
              </span>
            </div>
            <input
              ref={inputRef}
              value={paletteQuery}
              onChange={(event) => setPaletteQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  if (paletteRows.length > 0) {
                    setPaletteSelectedIndex((current) => (current + 1) % paletteRows.length);
                  }
                  return;
                }
                if (event.key === "ArrowUp") {
                  event.preventDefault();
                  if (paletteRows.length > 0) {
                    setPaletteSelectedIndex((current) =>
                      current <= 0 ? paletteRows.length - 1 : current - 1
                    );
                  }
                  return;
                }
                if (event.key === "Enter") {
                  event.preventDefault();
                  handleRowEnter();
                }
              }}
              placeholder="Search hosts, sessions, snippets, or jump to a section"
              aria-label="Command palette query"
              aria-activedescendant={selectedRowKey ? `palette-row-${selectedRowKey}` : undefined}
              className="mt-3.5 w-full rounded-[18px] border border-slate-700 bg-slate-950/80 px-4 py-2.5 text-sm text-slate-50 outline-none transition focus:border-emerald-400/60 focus:ring-2 focus:ring-emerald-400/20"
            />
            {paletteRows.length > 0 ? (
              <p className="mt-2 text-[11px] text-slate-500">
                {paletteRows.length} result{paletteRows.length === 1 ? "" : "s"} • ↑/↓ to navigate •
                Enter to activate
              </p>
            ) : (
              <p className="mt-2 text-[11px] text-slate-500">No matches.</p>
            )}

            <div className="mt-3.5 grid gap-3 lg:grid-cols-2 2xl:grid-cols-[0.8fr_0.9fr_1fr_1fr]">
              {matchingActiveCommands.length > 0 ? (
                <section className="rounded-[20px] border border-emerald-400/30 bg-emerald-400/5 p-3 lg:col-span-2 2xl:col-span-4">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-emerald-300">
                    Active session — {activeSessionTab?.title ?? "current"}
                  </p>
                  <div className="mt-2.5 grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {matchingActiveCommands.map((command) => (
                      <button
                        key={command.key}
                        type="button"
                        id={`palette-row-${command.key}`}
                        onClick={() => command.run()}
                        className={cn(
                          "rounded-xl border px-3 py-2 text-left transition",
                          isRowSelected(command.key)
                            ? "border-emerald-400 bg-emerald-400/15 ring-1 ring-emerald-400/40"
                            : "border-slate-800 bg-slate-900/80 hover:border-emerald-400/50 hover:bg-slate-900"
                        )}
                      >
                        <span className="block text-sm font-medium text-slate-100">
                          {command.label}
                        </span>
                        <span className="mt-1 block truncate text-[11px] text-slate-400">
                          {command.sublabel}
                        </span>
                      </button>
                    ))}
                  </div>
                </section>
              ) : null}

              {matchingRecent.length > 0 ? (
                <section className="rounded-[20px] border border-slate-800 bg-slate-950/60 p-3 lg:col-span-2 2xl:col-span-4">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">
                    Recent
                  </p>
                  <div className="mt-2.5 grid gap-2 sm:grid-cols-2">
                    {matchingRecent.map((command) => (
                      <button
                        key={command.key}
                        type="button"
                        id={`palette-row-${command.key}`}
                        onClick={() => command.run()}
                        className={cn(
                          "rounded-xl border px-3 py-2 text-left transition",
                          isRowSelected(command.key)
                            ? "border-emerald-400 bg-emerald-400/15 ring-1 ring-emerald-400/40"
                            : "border-slate-800 bg-slate-900/80 hover:border-slate-600 hover:bg-slate-900"
                        )}
                      >
                        <span className="block text-sm font-medium text-slate-100">
                          {command.label}
                        </span>
                        <span className="mt-1 block truncate text-[11px] text-slate-400">
                          {command.sublabel}
                        </span>
                      </button>
                    ))}
                  </div>
                </section>
              ) : null}

              <section className="rounded-[20px] border border-slate-800 bg-slate-950/60 p-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">
                  Sections
                </p>
                <div className="mt-2.5 space-y-2">
                  {matchingSections.map((item) => {
                    const sectionShortcut = navigationItems.findIndex(
                      (entry) => entry.path === item.path
                    );

                    return (
                      <button
                        key={item.path}
                        type="button"
                        id={`palette-row-section:${item.path}`}
                        onClick={() => focusSection(item.path)}
                        className={cn(
                          "flex w-full items-center justify-between rounded-xl border px-3 py-2.5 text-left transition",
                          isRowSelected(`section:${item.path}`)
                            ? "border-emerald-400 bg-emerald-400/15 ring-1 ring-emerald-400/40"
                            : location.pathname.startsWith(item.path)
                              ? "border-emerald-400/50 bg-emerald-400/10"
                              : "border-slate-800 bg-slate-900/80 hover:border-slate-600 hover:bg-slate-900"
                        )}
                      >
                        <span className="min-w-0">
                          <span className="block text-sm font-medium text-slate-100">{item.label}</span>
                          <span className="mt-1 block truncate text-xs text-slate-400">
                            {item.description}
                          </span>
                        </span>
                        <div className="ml-3 flex shrink-0 items-center gap-1.5">
                          {sectionShortcut >= 0 ? (
                            <span className="rounded-full border border-slate-700 bg-slate-950/80 px-2 py-1 text-[10px] text-slate-400">
                              {formatPrimaryShortcut(String(sectionShortcut + 1))}
                            </span>
                          ) : null}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </section>

              <section className="rounded-[22px] border border-slate-800 bg-slate-950/60 p-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">
                  Sessions
                </p>
                <div className="mt-2.5 space-y-2">
                  {matchingSessionTabs.length ? (
                    matchingSessionTabs.map((tab) => {
                      const host = hosts.find((entry) => entry.id === tab.hostId);
                      const activePane = sessionPanes[tab.activePaneId];

                      return (
                        <button
                          key={tab.id}
                          type="button"
                          id={`palette-row-session:${tab.id}`}
                          onClick={() => focusSession(tab.id)}
                          className={cn(
                            "flex w-full items-center justify-between rounded-xl border px-3 py-2.5 text-left transition",
                            isRowSelected(`session:${tab.id}`)
                              ? "border-emerald-400 bg-emerald-400/15 ring-1 ring-emerald-400/40"
                              : activeSessionTabId === tab.id
                                ? "border-emerald-400/50 bg-emerald-400/10"
                                : "border-slate-800 bg-slate-900/80 hover:border-slate-600 hover:bg-slate-900"
                          )}
                        >
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-medium text-slate-100">
                              {tab.title}
                            </span>
                            <span className="mt-1 block truncate text-xs text-slate-400">
                              {tab.paneIds.length} pane{tab.paneIds.length === 1 ? "" : "s"} •{" "}
                              {host?.hostname ?? "Unknown host"}
                            </span>
                          </span>
                          <span className="rounded-full border border-slate-700 bg-slate-950/80 px-2 py-1 text-[11px] uppercase tracking-[0.14em] text-slate-300">
                            {activePane?.connectionState ?? "idle"}
                          </span>
                        </button>
                      );
                    })
                  ) : (
                    <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-900/50 px-4 py-6 text-sm text-slate-400">
                      No open session matches the current palette query.
                    </div>
                  )}
                </div>
              </section>

              <section className="rounded-[22px] border border-slate-800 bg-slate-950/60 p-3">
                <div className="flex items-center justify-between gap-4">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">
                    Hosts
                  </p>
                  <button
                    type="button"
                    onClick={() => focusSection("/hosts?new=1")}
                    className="rounded-full border border-slate-700 px-3 py-1 text-xs text-slate-300 transition hover:border-slate-500 hover:text-white"
                  >
                    Add host
                  </button>
                </div>
                <div className="mt-2.5 space-y-2">
                  {matchingHosts.length ? (
                    matchingHosts.map((host) => (
                      <div
                        key={host.id}
                        id={`palette-row-host:${host.id}`}
                        className={cn(
                          "rounded-xl border px-3 py-2.5",
                          isRowSelected(`host:${host.id}`)
                            ? "border-emerald-400 bg-emerald-400/15 ring-1 ring-emerald-400/40"
                            : "border-slate-800 bg-slate-900/80"
                        )}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <button
                            type="button"
                            onClick={() => launchHostSession(host.id)}
                            className="min-w-0 flex-1 text-left"
                          >
                            <span className="block text-sm font-medium text-slate-100">
                              {host.label}
                            </span>
                            <span className="mt-1 block truncate text-xs text-slate-400">
                              {formatHostAddress(host)}
                            </span>
                          </button>
                          <div className="flex shrink-0 gap-1.5">
                            <button
                              type="button"
                              onClick={() => launchHostSession(host.id)}
                              className="rounded-lg bg-emerald-400 px-2.5 py-1 text-[11px] font-medium text-slate-950 transition hover:bg-emerald-300"
                            >
                              Open
                            </button>
                            {hostSupportsSftp(host.protocol) ? (
                              <button
                                type="button"
                                onClick={() => openHostTransfers(host.id)}
                                className="rounded-lg border border-slate-700 px-2.5 py-1 text-[11px] text-slate-300 transition hover:border-slate-500 hover:text-white"
                              >
                                Files
                              </button>
                            ) : null}
                            {hostSupportsTrustedKeys(host.protocol) ? (
                              <button
                                type="button"
                                onClick={() => manageHostTrust(host.id)}
                                className="rounded-lg border border-slate-700 px-2.5 py-1 text-[11px] text-slate-300 transition hover:border-slate-500 hover:text-white"
                              >
                                Trust
                              </button>
                            ) : null}
                            <button
                              type="button"
                              onClick={() => focusHost(host.id)}
                              className="rounded-lg border border-slate-700 px-2.5 py-1 text-[11px] text-slate-300 transition hover:border-slate-500 hover:text-white"
                            >
                              Inspect
                            </button>
                          </div>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-900/50 px-4 py-6 text-sm text-slate-400">
                      No host matches the current palette query.
                    </div>
                  )}
                </div>
              </section>

              <section className="rounded-[22px] border border-slate-800 bg-slate-950/60 p-3">
                <div className="flex items-center justify-between gap-4">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">
                    Snippets
                  </p>
                  <button
                    type="button"
                    onClick={() => focusSection("/snippets")}
                    className="rounded-full border border-slate-700 px-3 py-1 text-xs text-slate-300 transition hover:border-slate-500 hover:text-white"
                  >
                    Library
                  </button>
                </div>
                <div className="mt-2.5 space-y-2">
                  {matchingSnippets.length ? (
                    matchingSnippets.map((snippet) => (
                      <div
                        key={snippet.id}
                        id={`palette-row-snippet:${snippet.id}`}
                        className={cn(
                          "rounded-xl border px-3 py-2.5",
                          isRowSelected(`snippet:${snippet.id}`)
                            ? "border-emerald-400 bg-emerald-400/15 ring-1 ring-emerald-400/40"
                            : "border-slate-800 bg-slate-900/80"
                        )}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <button
                            type="button"
                            onClick={() => focusSection("/snippets")}
                            className="min-w-0 flex-1 text-left"
                          >
                            <span className="block truncate text-sm font-medium text-slate-100">
                              {snippet.title}
                            </span>
                            <span className="mt-1 block truncate text-xs text-slate-400">
                              {snippet.tags.join(" · ") || "No tags"} · {snippet.targetHostIds.length} target
                              {snippet.targetHostIds.length === 1 ? "" : "s"}
                            </span>
                          </button>
                          <div className="flex shrink-0 gap-1.5">
                            <button
                              type="button"
                              onClick={() => runSnippetInActivePane(snippet.id)}
                              className="rounded-lg bg-emerald-400 px-2.5 py-1 text-[11px] font-medium text-slate-950 transition hover:bg-emerald-300"
                            >
                              {activeSessionPane ? "Run" : "Open"}
                            </button>
                            <button
                              type="button"
                              onClick={() => focusSection("/snippets")}
                              className="rounded-lg border border-slate-700 px-2.5 py-1 text-[11px] text-slate-300 transition hover:border-slate-500 hover:text-white"
                            >
                              View
                            </button>
                          </div>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-900/50 px-4 py-6 text-sm text-slate-400">
                      No snippet matches the current palette query.
                    </div>
                  )}
                </div>
              </section>
            </div>
          </div>
        </div>
      ) : null}
      <KeyboardCheatsheet />
      <FirstRunTour />
    </div>
  );
}
