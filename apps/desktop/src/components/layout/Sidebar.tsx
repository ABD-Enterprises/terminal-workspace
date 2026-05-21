import { useMemo } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { launchHostSession } from "../../lib/launch-host-session";
import { navigationItems } from "../../lib/navigation";
import { cn, formatDurationSince } from "../../lib/utils";
import { useAppStore } from "../../store/app-store";
import { useHostsStore } from "../../store/hosts-store";
import { useSessionsStore } from "../../store/sessions-store";
import { formatSessionConnectionState } from "../../types/session";
import { SearchInput } from "../common/SearchInput";
import { SidebarGroups } from "./SidebarGroups";

export function Sidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  const hosts = useHostsStore((state) => state.hosts);
  const ensureLocalShellHost = useHostsStore((state) => state.ensureLocalShellHost);
  const sidebarSearch = useAppStore((state) => state.sidebarSearch);
  const setSidebarSearch = useAppStore((state) => state.setSidebarSearch);
  const workspaceDensity = useAppStore((state) => state.workspaceDensity);
  const sessionTabs = useSessionsStore((state) => state.tabs);
  const sessionPanes = useSessionsStore((state) => state.panes);
  const activeSessionTabId = useSessionsStore((state) => state.activeTabId);
  const selectSessionTab = useSessionsStore((state) => state.selectTab);

  // T01: one-click Local Terminal quick-launch. Ensures the canonical
  // local-shell host record exists, then routes to (or reuses) its
  // session. If a local-shell tab is already open, focus that tab
  // instead of spawning a duplicate.
  const openLocalTerminal = async () => {
    const localShell = ensureLocalShellHost();
    const existingTab = sessionTabs.find((tab) => tab.hostId === localShell.id);
    if (existingTab) {
      selectSessionTab(existingTab.id);
      navigate(`/sessions?tabId=${existingTab.id}`);
      return;
    }
    const result = await launchHostSession(localShell);
    if (!result.ok || !result.tabId) {
      if (result.errorMessage) {
        console.warn(`[sidebar] ${result.errorMessage}`);
      }
      return;
    }
    navigate(`/sessions?tabId=${result.tabId}`);
  };
  const favoriteCount = hosts.filter((host) => host.favorite).length;
  const groupCount = new Set(hosts.map((host) => host.group).filter(Boolean)).size;
  const pinnedHosts = useMemo(
    () =>
      hosts
        .filter((host) => host.favorite)
        .sort((left, right) => left.label.localeCompare(right.label)),
    [hosts]
  );
  // T06: Recent connections — top 5 by lastConnectedAt desc. Hosts
  // that have never been connected are excluded so the panel only
  // shows once the user has actually used the app.
  const recentHosts = useMemo(
    () =>
      hosts
        .filter((host) => Boolean(host.lastConnectedAt))
        .sort((left, right) =>
          (right.lastConnectedAt ?? "").localeCompare(left.lastConnectedAt ?? "")
        )
        .slice(0, 5),
    [hosts]
  );
  const sessionRows = useMemo(
    () =>
      sessionTabs.map((tab) => {
        const host = hosts.find((entry) => entry.id === tab.hostId);
        const activePane = sessionPanes[tab.activePaneId];
        const anchorPane = sessionPanes[tab.paneIds[0] ?? tab.activePaneId];

        return {
          tabId: tab.id,
          hostname: host?.hostname ?? "Unknown host",
          status: formatSessionConnectionState(activePane?.connectionState ?? "disconnected"),
          duration: formatDurationSince(anchorPane?.createdAt),
          active: tab.id === activeSessionTabId,
        };
      }),
    [activeSessionTabId, hosts, sessionPanes, sessionTabs]
  );

  return (
    <aside
      className={cn(
        "flex shrink-0 flex-col border-r border-slate-800/80 bg-slate-950/85 backdrop-blur-xl",
        workspaceDensity === "compact" ? "w-[226px] px-2 py-2" : "w-[244px] px-2.5 py-2.5"
      )}
    >
      <div
        className={cn(
          "rounded-[18px] border border-slate-800/90 bg-slate-900/60",
          workspaceDensity === "compact" ? "px-3 py-2" : "px-3.5 py-2.5"
        )}
      >
        <p className="text-[10px] font-semibold uppercase tracking-[0.26em] text-emerald-300">
          TermSnip
        </p>
        <h1 className="mt-0.5 text-base font-semibold text-slate-50">Local Vault</h1>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-400">
          <span>{hosts.length} hosts</span>
          <span>•</span>
          <span>{favoriteCount} favorites</span>
          <span>•</span>
          <span>{groupCount} groups</span>
        </div>
      </div>

      <div className="mt-2">
        <SearchInput
          value={sidebarSearch}
          onChange={setSidebarSearch}
          placeholder="Search the host inventory"
        />
      </div>

      <button
        type="button"
        onClick={openLocalTerminal}
        aria-label="Open local terminal"
        className={cn(
          "mt-2 flex items-center justify-between rounded-[14px] border border-emerald-400/40 bg-emerald-400/10 text-left transition hover:border-emerald-400/70 hover:bg-emerald-400/15",
          workspaceDensity === "compact" ? "px-2.5 py-1.5" : "px-3 py-2"
        )}
      >
        <span className="min-w-0">
          <span className="block text-[13px] font-medium text-emerald-100">
            Local terminal
          </span>
          <span className="mt-0.5 block truncate text-[10px] leading-4 text-emerald-200/70">
            Spawn or focus your macOS login shell
          </span>
        </span>
        <span aria-hidden="true" className="text-emerald-300">
          ⌘
        </span>
      </button>

      <nav className={cn("mt-2", workspaceDensity === "compact" ? "space-y-1" : "space-y-1.5")}>
        {navigationItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            className={({ isActive }) =>
              cn(
                "flex items-center justify-between rounded-[14px] border transition",
                workspaceDensity === "compact" ? "px-2.5 py-1.5" : "px-3 py-2",
                isActive
                  ? "border-emerald-400/50 bg-emerald-400/10"
                  : "border-slate-800 bg-slate-900/70 hover:border-slate-700 hover:bg-slate-900"
              )
            }
          >
            <span className="min-w-0">
              <span className="block text-[13px] font-medium text-slate-100">{item.label}</span>
              <span className="mt-0.5 block truncate text-[10px] leading-4 text-slate-500">
                {item.description}
              </span>
            </span>
          </NavLink>
        ))}
      </nav>

      {recentHosts.length > 0 ? (
        <div
          role="region"
          aria-label="Recent connections"
          className="mt-2 rounded-[18px] border border-slate-800/90 bg-slate-900/60"
        >
          <div className="flex items-center justify-between border-b border-slate-800/80 px-3 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-sky-300/90">
              Recent
            </p>
            <span className="text-[10px] uppercase tracking-[0.18em] text-slate-500">
              {recentHosts.length}
            </span>
          </div>
          <div className="max-h-44 overflow-auto px-2 py-2 space-y-1">
            {recentHosts.map((host) => {
              const existingTab = sessionTabs.find((tab) => tab.hostId === host.id);
              const active = existingTab && existingTab.id === activeSessionTabId;
              return (
                <button
                  key={`recent-${host.id}`}
                  type="button"
                  title={`${host.username}@${host.hostname}:${host.port}`}
                  onClick={async () => {
                    if (existingTab) {
                      selectSessionTab(existingTab.id);
                      navigate(`/sessions?tabId=${existingTab.id}`);
                      return;
                    }
                    const result = await launchHostSession(host);
                    if (!result.ok || !result.tabId) {
                      if (result.errorMessage) {
                        console.warn(`[sidebar:recent] ${result.errorMessage}`);
                      }
                      return;
                    }
                    navigate(`/sessions?tabId=${result.tabId}`);
                  }}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-[14px] border px-2 py-1.5 text-left transition",
                    active
                      ? "border-emerald-400/50 bg-emerald-400/10"
                      : "border-slate-800 bg-slate-950/60 hover:border-sky-400/40 hover:bg-slate-900"
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      "h-1.5 w-1.5 shrink-0 rounded-full",
                      existingTab ? "bg-emerald-400" : "bg-sky-300/70"
                    )}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12px] font-medium text-slate-100">
                      {host.label}
                    </span>
                    <span className="mt-0.5 block truncate text-[10px] text-slate-500">
                      {host.hostname}
                      {host.port && host.port !== 22 ? `:${host.port}` : ""}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {pinnedHosts.length > 0 ? (
        <div className="mt-2 rounded-[18px] border border-slate-800/90 bg-slate-900/60">
          <div className="flex items-center justify-between border-b border-slate-800/80 px-3 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-amber-300/90">
              Pinned
            </p>
            <span className="text-[10px] uppercase tracking-[0.18em] text-slate-500">
              {pinnedHosts.length}
            </span>
          </div>
          <div className="max-h-44 overflow-auto px-2 py-2 space-y-1">
            {pinnedHosts.map((host) => {
              const existingTab = sessionTabs.find((tab) => tab.hostId === host.id);
              const active = existingTab && existingTab.id === activeSessionTabId;
              return (
                <button
                  key={host.id}
                  type="button"
                  title={`${host.username}@${host.hostname}:${host.port}`}
                  onClick={async () => {
                    const result = await launchHostSession(host);
                    if (!result.ok || !result.tabId) {
                      if (result.errorMessage) {
                        console.warn(`[sidebar] ${result.errorMessage}`);
                      }
                      return;
                    }
                    navigate(`/sessions?tabId=${result.tabId}`);
                  }}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-[14px] border px-2 py-1.5 text-left transition",
                    active
                      ? "border-emerald-400/50 bg-emerald-400/10"
                      : "border-slate-800 bg-slate-950/60 hover:border-amber-400/40 hover:bg-slate-900"
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      "h-1.5 w-1.5 shrink-0 rounded-full",
                      existingTab ? "bg-emerald-400" : "bg-amber-300"
                    )}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12px] font-medium text-slate-100">
                      {host.label}
                    </span>
                    <span className="mt-0.5 block truncate text-[10px] text-slate-500">
                      {host.hostname}
                      {host.port && host.port !== 22 ? `:${host.port}` : ""}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      <div className="mt-2 min-h-0 flex-1 overflow-hidden rounded-[18px] border border-slate-800/90 bg-slate-900/60">
        <div className="border-b border-slate-800/80 px-3 py-2">
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-500">
            Sessions
          </p>
          <div className="mt-1 grid grid-cols-[minmax(0,1fr)_auto_auto] gap-2 text-[10px] uppercase tracking-[0.18em] text-slate-600">
            <span>Host</span>
            <span>Status</span>
            <span>Duration</span>
          </div>
        </div>
        <div className="max-h-full overflow-auto px-2 py-2">
          {sessionRows.length ? (
            <div className="space-y-1">
              {sessionRows.map((session) => (
                <button
                  key={session.tabId}
                  type="button"
                  onClick={() => {
                    selectSessionTab(session.tabId);
                    if (!location.pathname.startsWith("/sessions")) {
                      navigate(`/sessions?tabId=${session.tabId}`);
                    } else {
                      navigate(`/sessions?tabId=${session.tabId}`, { replace: true });
                    }
                  }}
                  className={cn(
                    "grid w-full grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 rounded-[14px] border px-2 py-2 text-left transition",
                    session.active
                      ? "border-emerald-400/50 bg-emerald-400/10"
                      : "border-slate-800 bg-slate-950/60 hover:border-slate-700 hover:bg-slate-900"
                  )}
                >
                  <span className="truncate text-[12px] font-medium text-slate-100">
                    {session.hostname}
                  </span>
                  <span className="text-[11px] text-slate-400">{session.status}</span>
                  <span className="text-[11px] text-slate-500">{session.duration}</span>
                </button>
              ))}
            </div>
          ) : (
            <p className="rounded-[14px] border border-dashed border-slate-800 px-2.5 py-2 text-[11px] text-slate-500">
              Open a host to pin its session here for quick switching.
            </p>
          )}
        </div>
      </div>

      <SidebarGroups searchQuery={sidebarSearch} />
    </aside>
  );
}
