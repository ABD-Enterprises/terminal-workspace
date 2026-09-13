import { useLocation } from "react-router-dom";
import { navigationItems } from "../../lib/navigation";
import { formatPrimaryShortcut } from "../../lib/shortcuts";
import { cn, formatHostAddress } from "../../lib/utils";
import { useAppStore } from "../../store/app-store";
import { useHostsStore } from "../../store/hosts-store";
import { useSessionsStore } from "../../store/sessions-store";
import { hostSupportsSftp, hostSupportsTrustedKeys } from "../../types/host";

import { useCommandPaletteRows } from "./use-command-palette-rows";

type CommandPaletteDialogProps = ReturnType<typeof useCommandPaletteRows>;

export function CommandPaletteDialog({
  paletteQuery,
  setPaletteQuery,
  setPaletteSelectedIndex,
  inputRef,
  activeSessionTab,
  activeSessionPane,
  matchingSections,
  matchingHosts,
  matchingSessionTabs,
  matchingSnippets,
  matchingActiveCommands,
  matchingRecent,
  paletteRows,
  selectedRowKey,
  isRowSelected,
  handleRowEnter,
  focusHost,
  launchHostSession,
  openHostTransfers,
  manageHostTrust,
  focusSection,
  focusSession,
  runSnippetInActivePane,
}: CommandPaletteDialogProps) {
  const location = useLocation();
  const hosts = useHostsStore((state) => state.hosts);
  const sessionPanes = useSessionsStore((state) => state.panes);
  const activeSessionTabId = useSessionsStore((state) => state.activeTabId);
  const closeCommandPalette = useAppStore((state) => state.closeCommandPalette);
  const sectionShortcutsEnabled = useAppStore((state) => state.sectionShortcutsEnabled);

  return (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-950/70 px-6 py-20 backdrop-blur-xs">
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
                            ? "border-emerald-400/45 bg-emerald-400/10"
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
                            ? "border-emerald-400/45 bg-emerald-400/10"
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
                            ? "border-emerald-400/45 bg-emerald-400/10"
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
                              ? "border-emerald-400/45 bg-emerald-400/10"
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
                            ? "border-emerald-400/45 bg-emerald-400/10"
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
                            ? "border-emerald-400/45 bg-emerald-400/10"
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
  );
}
