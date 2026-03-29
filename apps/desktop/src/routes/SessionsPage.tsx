import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { TerminalWorkspace } from "../components/terminal/TerminalWorkspace";
import { useHostsStore } from "../store/hosts-store";
import { useSessionsStore } from "../store/sessions-store";

const terminalMilestones = [
  { label: "Native SSH", detail: "Connect and disconnect flows are live." },
  { label: "Tabs", detail: "Multiple tabs with session titles are live." },
  { label: "Split panes", detail: "Split panes and resize handling are live." },
  { label: "Restore", detail: "Reconnect and session restore work on relaunch." },
];

export function SessionsPage() {
  const [searchParams] = useSearchParams();
  const hostId = searchParams.get("hostId");
  const tabId = searchParams.get("tabId");
  const selectedHost = useHostsStore((state) =>
    state.hosts.find((host) => host.id === hostId)
  );
  const selectTab = useSessionsStore((state) => state.selectTab);
  const tabCount = useSessionsStore((state) => state.tabs.length);
  const activePaneCount = useSessionsStore((state) => {
    const activeTab = state.tabs.find((tab) => tab.id === state.activeTabId);
    return activeTab?.paneIds.length ?? 0;
  });

  useEffect(() => {
    if (tabId) {
      selectTab(tabId);
    }
  }, [selectTab, tabId]);

  return (
    <section className="flex h-full min-h-0 flex-col gap-2.5">
      <div className="rounded-[20px] border border-slate-800/80 bg-slate-950/45 px-3.5 py-2.5">
        <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_auto]">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-300">
              Session runtime
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
              <h2 className="text-lg font-semibold text-slate-50">Tabs, panes, reconnect, and restore.</h2>
              <p className="text-[12px] text-slate-400">
                {tabCount} tab{tabCount === 1 ? "" : "s"} active · {activePaneCount} pane{activePaneCount === 1 ? "" : "s"} in focus
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {terminalMilestones.map((milestone) => (
              <div
                key={milestone.label}
                title={milestone.detail}
                className="rounded-full border border-slate-800 bg-slate-900/60 px-2.5 py-1 text-[11px] text-slate-300"
              >
                {milestone.label}
              </div>
            ))}
          </div>
        </div>
      </div>
      <TerminalWorkspace launchHost={selectedHost} />
    </section>
  );
}
