import { useEffect, useMemo, useState } from "react";
import { useSessions } from "../../hooks/useSessions";
import { SearchInput } from "../common/SearchInput";
import { buildHostSearchText } from "../../lib/utils";
import { useHostsStore } from "../../store/hosts-store";
import { useSessionsStore } from "../../store/sessions-store";
import type { HostRecord } from "../../types/host";
import { EmptyState } from "../common/EmptyState";
import { PortForwardPanel } from "./PortForwardPanel";
import { SplitLayout } from "./SplitLayout";
import { TerminalPane } from "./TerminalPane";
import { TerminalTabView } from "./TerminalTabView";

interface TerminalWorkspaceProps {
  launchHost?: HostRecord;
}

export function TerminalWorkspace({ launchHost }: TerminalWorkspaceProps) {
  const { tabs, panes, hosts, activeTab, activePanes } = useSessions();
  const [quickConnectQuery, setQuickConnectQuery] = useState("");
  const openSession = useSessionsStore((state) => state.openSession);
  const duplicateSession = useSessionsStore((state) => state.duplicateSession);
  const selectTab = useSessionsStore((state) => state.selectTab);
  const closeTab = useSessionsStore((state) => state.closeTab);
  const splitTab = useSessionsStore((state) => state.splitTab);
  const closePane = useSessionsStore((state) => state.closePane);
  const selectPane = useSessionsStore((state) => state.selectPane);
  const setSplitDirection = useSessionsStore((state) => state.setSplitDirection);
  const allHosts = useHostsStore((state) => state.hosts);
  const quickConnectHosts = useMemo(() => {
    const normalizedQuery = quickConnectQuery.trim().toLowerCase();

    if (!normalizedQuery) {
      return allHosts.slice(0, 6);
    }

    return allHosts
      .filter((host) => buildHostSearchText(host).includes(normalizedQuery))
      .slice(0, 8);
  }, [allHosts, quickConnectQuery]);

  useEffect(() => {
    if (!launchHost) {
      return;
    }

    const existingTab = tabs.find((tab) => tab.hostId === launchHost.id);
    if (existingTab) {
      selectTab(existingTab.id);
      return;
    }

    openSession(launchHost);
  }, [launchHost, openSession, selectTab, tabs]);

  if (!activeTab) {
    return (
      <EmptyState
        title="No active terminal sessions"
        description="Open a host from the inventory to create a session tab. Session tabs and split panes are now persisted locally and will restore on the next launch."
      />
    );
  }

  const activeHost = hosts[activeTab.hostId];
  const activePane = panes[activeTab.activePaneId];

  return (
    <section className="flex h-full min-h-0 flex-col gap-2.5">
      <div className="rounded-[20px] border border-slate-800/80 bg-slate-950/45 p-2">
        <TerminalTabView
          tabs={tabs}
          panes={panes}
          hosts={hosts}
          activeTabId={activeTab.id}
          onSelect={selectTab}
          onClose={closeTab}
        />
      </div>

      <div className="grid min-h-0 flex-1 gap-2.5 xl:grid-cols-[minmax(0,1fr)_272px]">
        <div className="rounded-[20px] border border-slate-800/80 bg-slate-950/45 p-2">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-emerald-300">
                Session workspace
              </p>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                <h3 className="text-base font-semibold text-slate-50">{activeTab.title}</h3>
                <p className="text-[11px] text-slate-500">
                  {activePanes.length} pane{activePanes.length === 1 ? "" : "s"} · {activeTab.splitDirection} split
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={!activeHost}
                onClick={() => {
                  if (activeHost) {
                    duplicateSession(activeHost);
                  }
                }}
                className="rounded-lg border border-slate-700 px-3 py-1 text-sm text-slate-200 transition hover:border-slate-500 hover:text-white disabled:cursor-not-allowed disabled:border-slate-800 disabled:text-slate-600"
              >
                Duplicate tab
              </button>
              <button
                type="button"
                onClick={() =>
                  setSplitDirection(
                    activeTab.id,
                    activeTab.splitDirection === "vertical" ? "horizontal" : "vertical"
                  )
                }
                className="rounded-lg border border-slate-700 px-3 py-1 text-sm text-slate-200 transition hover:border-slate-500 hover:text-white"
              >
                {activeTab.splitDirection === "vertical" ? "Horizontal split" : "Vertical split"}
              </button>
              <button
                type="button"
                onClick={() => {
                  if (activeHost) {
                    splitTab(activeTab.id, activeHost);
                  }
                }}
                className="rounded-lg bg-emerald-400 px-3 py-1 text-sm font-medium text-slate-950 transition hover:bg-emerald-300"
              >
                Add pane
              </button>
            </div>
          </div>

          <SplitLayout direction={activeTab.splitDirection} count={activePanes.length}>
            {activePanes.map((pane) => {
              const host = hosts[pane.hostId];
              if (!host) {
                return null;
              }

              return (
                <TerminalPane
                  key={pane.id}
                  host={host}
                  pane={pane}
                  active={activeTab.activePaneId === pane.id}
                  onActivate={() => selectPane(activeTab.id, pane.id)}
                  onSplit={() => splitTab(activeTab.id, host)}
                  onClose={() => closePane(activeTab.id, pane.id)}
                />
              );
            })}
          </SplitLayout>
        </div>

        <aside className="min-h-0 overflow-auto rounded-[20px] border border-slate-800/80 bg-slate-950/45 p-2.5">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
            Session details
          </p>
          <h3 className="mt-1 text-base font-semibold text-slate-50">{activeHost?.label}</h3>
          <p className="mt-0.5 text-sm text-slate-400">
            {activeHost?.username}@{activeHost?.hostname}:{activeHost?.port}
          </p>

          <div className="mt-2.5 grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
            <div className="rounded-[16px] border border-slate-800 bg-slate-900/60 p-2.5">
              <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Restore state</p>
              <p className="mt-1 text-sm leading-5 text-slate-300">
                Tabs and panes restore locally on relaunch.
              </p>
            </div>
            <div className="rounded-[16px] border border-slate-800 bg-slate-900/60 p-2.5">
              <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Runtime</p>
              <p className="mt-1 text-sm leading-5 text-slate-300">
                SSH traffic is routed through the local bridge for now.
              </p>
            </div>
          </div>

          <div className="mt-2.5 rounded-[16px] border border-slate-800 bg-slate-900/60 p-2.5">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Quick connect</p>
              <p className="text-[10px] text-slate-600">Reuse or new tab</p>
            </div>
            <SearchInput
              value={quickConnectQuery}
              onChange={setQuickConnectQuery}
              placeholder="Search hosts to connect"
              className="mt-2"
            />
            <div className="mt-2 space-y-1.5">
              {quickConnectHosts.length ? (
                quickConnectHosts.map((host) => (
                  <div
                    key={host.id}
                    className="flex items-center gap-1.5 rounded-[14px] border border-slate-800 bg-slate-950/60 px-2 py-1.5"
                  >
                    <button
                      type="button"
                      onClick={() => openSession(host)}
                      className="min-w-0 flex-1 text-left transition hover:text-white"
                    >
                      <span className="block truncate text-[13px] font-medium text-slate-100">
                        {host.label}
                      </span>
                      <span className="mt-0.5 block truncate text-[11px] text-slate-500">
                        {host.username}@{host.hostname}:{host.port}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => duplicateSession(host)}
                      className="rounded-lg border border-slate-700 px-2 py-1 text-[11px] text-slate-200 transition hover:border-slate-500 hover:text-white"
                    >
                      New
                    </button>
                  </div>
                ))
              ) : (
                <p className="rounded-[14px] border border-dashed border-slate-800 px-2.5 py-2 text-[11px] text-slate-500">
                  No hosts match the quick-connect query.
                </p>
              )}
            </div>
          </div>

          <PortForwardPanel
            key={activePane?.id ?? "no-pane"}
            sessionId={activePane?.backendSessionId}
            disabled={activePane?.connectionState !== "connected"}
          />
        </aside>
      </div>
    </section>
  );
}
