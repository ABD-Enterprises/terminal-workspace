import { useEffect, useRef, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { useCommandPalette } from "../../hooks/useCommandPalette";
import { navigationItems } from "../../lib/navigation";
import { formatPrimaryShortcut, isPrimaryShortcut } from "../../lib/shortcuts";
import { cn } from "../../lib/utils";
import { useAppStore } from "../../store/app-store";
import { applyHostFilters, useHostsStore } from "../../store/hosts-store";
import { useSessionsStore } from "../../store/sessions-store";
import { useSnippetsStore } from "../../store/snippets-store";
import { useTransfersStore } from "../../store/transfers-store";
import { SessionRestoreManager } from "../terminal/SessionRestoreManager";
import { Sidebar } from "./Sidebar";
import { TopTabs } from "./TopTabs";

export function AppShell() {
  useCommandPalette();

  const location = useLocation();
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [paletteQuery, setPaletteQuery] = useState("");
  const hosts = useHostsStore((state) => state.hosts);
  const markConnected = useHostsStore((state) => state.markConnected);
  const sessionTabs = useSessionsStore((state) => state.tabs);
  const sessionPanes = useSessionsStore((state) => state.panes);
  const activeSessionTabId = useSessionsStore((state) => state.activeTabId);
  const openSession = useSessionsStore((state) => state.openSession);
  const queuePaneCommand = useSessionsStore((state) => state.queuePaneCommand);
  const selectSessionTab = useSessionsStore((state) => state.selectTab);
  const snippets = useSnippetsStore((state) => state.snippets);
  const markSnippetRun = useSnippetsStore((state) => state.markSnippetRun);
  const setActiveTransferHost = useTransfersStore((state) => state.setActiveHost);
  const activeItem =
    navigationItems.find((item) => location.pathname.startsWith(item.path)) ?? navigationItems[0];
  const commandPaletteOpen = useAppStore((state) => state.commandPaletteOpen);
  const closeCommandPalette = useAppStore((state) => state.closeCommandPalette);
  const setSidebarSearch = useAppStore((state) => state.setSidebarSearch);
  const workspaceDensity = useAppStore((state) => state.workspaceDensity);
  const sectionShortcutsEnabled = useAppStore((state) => state.sectionShortcutsEnabled);
  const activeSessionTab = sessionTabs.find((tab) => tab.id === activeSessionTabId) ?? sessionTabs[0];
  const activeSessionPane = activeSessionTab
    ? sessionPanes[activeSessionTab.activePaneId]
    : undefined;

  useEffect(() => {
    if (commandPaletteOpen) {
      inputRef.current?.focus();
    }
  }, [commandPaletteOpen]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
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
  }, [closeCommandPalette, navigate, sectionShortcutsEnabled]);

  const matchingSections = navigationItems.filter((item) => {
    if (!paletteQuery.trim()) {
      return true;
    }

    const haystack = `${item.label} ${item.description}`.toLowerCase();
    return haystack.includes(paletteQuery.trim().toLowerCase());
  });

  const matchingHosts = applyHostFilters(hosts, {
    query: paletteQuery,
    activeGroup: "all",
    activeTag: "all",
    favoritesOnly: false,
  }).slice(0, 6);
  const matchingSessionTabs = sessionTabs
    .filter((tab) => {
      if (!paletteQuery.trim()) {
        return true;
      }

      const host = hosts.find((entry) => entry.id === tab.hostId);
      const haystack = `${tab.title} ${host?.label ?? ""} ${host?.hostname ?? ""} ${host?.username ?? ""}`.toLowerCase();
      return haystack.includes(paletteQuery.trim().toLowerCase());
    })
    .slice(0, 6);
  const matchingSnippets = snippets
    .filter((snippet) => {
      if (!paletteQuery.trim()) {
        return true;
      }

      const haystack = [snippet.title, snippet.description, snippet.command, snippet.tags.join(" ")]
        .join(" ")
        .toLowerCase();
      return haystack.includes(paletteQuery.trim().toLowerCase());
    })
    .slice(0, 6);

  const focusHost = (hostId: string) => {
    setPaletteQuery("");
    setSidebarSearch("");
    navigate(`/hosts?focus=${hostId}`);
    closeCommandPalette();
  };

  const launchHostSession = (hostId: string) => {
    const host = hosts.find((entry) => entry.id === hostId);
    if (!host) {
      return;
    }

    markConnected(host.id);
    const tabId = openSession(host);
    setPaletteQuery("");
    navigate(`/sessions?tabId=${tabId}`);
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
    selectSessionTab(tabId);
    setPaletteQuery("");
    navigate(`/sessions?tabId=${tabId}`);
    closeCommandPalette();
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

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-transparent text-slate-100">
      <SessionRestoreManager />
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopTabs />
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
                <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-emerald-300">
                  Local-first SSH workspace
                </p>
                <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                  <h1 className="text-[17px] font-semibold text-slate-50">{activeItem.label}</h1>
                  <p className="truncate text-[11px] text-slate-500">{activeItem.description}</p>
                </div>
              </div>
            </div>
            <div
              className={cn(
                "min-h-0 flex-1 overflow-auto",
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
                if (event.key === "Enter") {
                  if (matchingSessionTabs[0]) {
                    focusSession(matchingSessionTabs[0].id);
                    return;
                  }

                  if (matchingHosts[0]) {
                    launchHostSession(matchingHosts[0].id);
                    return;
                  }

                  if (matchingSections[0]) {
                    focusSection(matchingSections[0].path);
                  }
                }
              }}
              placeholder="Search hosts, sessions, keys, snippets, settings"
              className="mt-3.5 w-full rounded-[18px] border border-slate-700 bg-slate-950/80 px-4 py-2.5 text-sm text-slate-50 outline-none transition focus:border-emerald-400/60 focus:ring-2 focus:ring-emerald-400/20"
            />

            <div className="mt-3.5 grid gap-3 lg:grid-cols-2 2xl:grid-cols-[0.8fr_0.9fr_1fr_1fr]">
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
                        onClick={() => focusSection(item.path)}
                        className={cn(
                          "flex w-full items-center justify-between rounded-xl border px-3 py-2.5 text-left transition",
                          location.pathname.startsWith(item.path)
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
                          {item.badge ? (
                            <span className="rounded-full border border-emerald-400/40 bg-emerald-400/10 px-2 py-1 text-[11px] uppercase tracking-[0.2em] text-emerald-200">
                              {item.badge}
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
                          onClick={() => focusSession(tab.id)}
                          className={cn(
                            "flex w-full items-center justify-between rounded-xl border px-3 py-2.5 text-left transition",
                            activeSessionTabId === tab.id
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
                        className="rounded-xl border border-slate-800 bg-slate-900/80 px-3 py-2.5"
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
                              {host.username}@{host.hostname}:{host.port}
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
                            <button
                              type="button"
                              onClick={() => openHostTransfers(host.id)}
                              className="rounded-lg border border-slate-700 px-2.5 py-1 text-[11px] text-slate-300 transition hover:border-slate-500 hover:text-white"
                            >
                              Files
                            </button>
                            <button
                              type="button"
                              onClick={() => manageHostTrust(host.id)}
                              className="rounded-lg border border-slate-700 px-2.5 py-1 text-[11px] text-slate-300 transition hover:border-slate-500 hover:text-white"
                            >
                              Trust
                            </button>
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
                        className="rounded-xl border border-slate-800 bg-slate-900/80 px-3 py-2.5"
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
    </div>
  );
}
