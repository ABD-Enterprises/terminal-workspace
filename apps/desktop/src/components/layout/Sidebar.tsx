import { useMemo, type ReactNode } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { launchHostSession } from "../../lib/launch-host-session";
import { navigationItems } from "../../lib/navigation";
import { selectMostRecentlyConnectedHosts } from "../../lib/recents";
import { cn, formatDurationSince } from "../../lib/utils";
import { useAppStore } from "../../store/app-store";
import { useHostsStore } from "../../store/hosts-store";
import { useSessionsStore } from "../../store/sessions-store";
import { formatSessionConnectionState } from "../../types/session";
import { SearchInput } from "../common/SearchInput";
import { SidebarGroups } from "./SidebarGroups";
import { SidebarSection } from "./SidebarSection";

// #107: single-line source-list rows carry an SF-Symbol-style glyph plus
// the label. Icons inherit the row's text color (currentColor) so the
// active row tints with the selection. Keyed by route path.
const NAV_ICONS: Record<string, ReactNode> = {
  "/hosts": (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      <rect x="2.5" y="2.75" width="11" height="4" rx="1.1" />
      <rect x="2.5" y="9.25" width="11" height="4" rx="1.1" />
      <circle cx="5" cy="4.75" r="0.55" fill="currentColor" stroke="none" />
      <circle cx="5" cy="11.25" r="0.55" fill="currentColor" stroke="none" />
    </svg>
  ),
  "/sessions": (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      <rect x="2" y="3" width="12" height="10" rx="1.6" />
      <path d="M4.6 6.8l2 1.6-2 1.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8.4 10h3.1" strokeLinecap="round" />
    </svg>
  ),
  "/snippets": (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      <path d="M3 4.5h10" strokeLinecap="round" />
      <path d="M3 8h7" strokeLinecap="round" />
      <path d="M3 11.5h9" strokeLinecap="round" />
    </svg>
  ),
  "/keys": (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      <circle cx="5.75" cy="5.75" r="3" />
      <path d="M7.9 7.9l5 5" strokeLinecap="round" />
      <path d="M10.8 10.8l1.6-1.6" strokeLinecap="round" />
    </svg>
  ),
  "/transfers": (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      <path d="M5 10.5V3" strokeLinecap="round" />
      <path d="M3 5l2-2 2 2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M11 5.5V13" strokeLinecap="round" />
      <path d="M9 11l2 2 2-2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  "/tunnels": (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      <path d="M2.5 8h8" strokeLinecap="round" />
      <path d="M7.5 5l3 3-3 3" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="13" cy="8" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  ),
  "/settings": (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      <path d="M3 5h5.2" strokeLinecap="round" />
      <path d="M11.2 5H13" strokeLinecap="round" />
      <circle cx="9.7" cy="5" r="1.4" />
      <path d="M3 11h2.3" strokeLinecap="round" />
      <path d="M8.3 11H13" strokeLinecap="round" />
      <circle cx="6.8" cy="11" r="1.4" />
    </svg>
  ),
};

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
  const recentHosts = useMemo(() => selectMostRecentlyConnectedHosts(hosts, 5), [hosts]);
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
      {/* Header — pinned above the single scroll region. */}
      <div className="px-1.5">
        <p className="text-[10px] font-semibold uppercase tracking-[0.26em] text-emerald-300">
          Terminal Workspace
        </p>
        <h1 className="mt-0.5 text-base font-semibold text-slate-50">Local Vault</h1>
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
          "mt-2 flex items-center justify-between rounded-[12px] border border-emerald-400/40 bg-emerald-400/10 text-left transition hover:border-emerald-400/70 hover:bg-emerald-400/15",
          workspaceDensity === "compact" ? "px-2.5 py-1.5" : "px-3 py-2"
        )}
      >
        <span className="text-[13px] font-medium text-emerald-100">Local terminal</span>
        <span aria-hidden="true" className="text-emerald-300">
          ⌘
        </span>
      </button>

      {/* #106: one scroll region for the whole source list (nav + sections). */}
      <div className="mt-2 min-h-0 flex-1 overflow-y-auto overflow-x-hidden pr-0.5">
        <nav aria-label="Primary" className="space-y-0.5">
          {navigationItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              title={item.description}
              aria-label={`${item.label} — ${item.description}`}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-2.5 rounded-lg px-2.5 text-[13px] transition",
                  workspaceDensity === "compact" ? "py-1.5" : "py-2",
                  isActive
                    ? "bg-emerald-400/15 font-medium text-emerald-100"
                    : "text-slate-300 hover:bg-slate-800/60 hover:text-slate-100"
                )
              }
            >
              <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                {NAV_ICONS[item.path]}
              </span>
              <span className="truncate">{item.label}</span>
            </NavLink>
          ))}
        </nav>

        {recentHosts.length > 0 ? (
          <SidebarSection
            title="Recent"
            count={recentHosts.length}
            accentClass="text-sky-300/90"
            regionLabel="Recent connections"
          >
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
                    "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition",
                    active ? "bg-emerald-400/10" : "hover:bg-slate-800/60"
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
          </SidebarSection>
        ) : null}

        {pinnedHosts.length > 0 ? (
          <SidebarSection title="Pinned" count={pinnedHosts.length} accentClass="text-amber-300/90">
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
                    "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition",
                    active ? "bg-emerald-400/10" : "hover:bg-slate-800/60"
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
          </SidebarSection>
        ) : null}

        <SidebarSection title="Sessions">
          {sessionRows.length ? (
            sessionRows.map((session) => (
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
                  "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition",
                  session.active ? "bg-emerald-400/10" : "hover:bg-slate-800/60"
                )}
              >
                <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-slate-100">
                  {session.hostname}
                </span>
                <span className="shrink-0 text-[10px] text-slate-400">{session.status}</span>
                <span className="shrink-0 text-[10px] tabular-nums text-slate-500">
                  {session.duration}
                </span>
              </button>
            ))
          ) : (
            <p className="px-2 py-1.5 text-[11px] text-slate-500">
              Open a host to pin its session here for quick switching.
            </p>
          )}
        </SidebarSection>

        <SidebarGroups searchQuery={sidebarSearch} />
      </div>
    </aside>
  );
}
