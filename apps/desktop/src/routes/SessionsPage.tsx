import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { TerminalWorkspace } from "../components/terminal/TerminalWorkspace";
import { useHostsStore } from "../store/hosts-store";
import { useSessionsStore } from "../store/sessions-store";

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
      {tabCount ? (
        <div className="rounded-[20px] border border-slate-800/80 bg-slate-950/45 px-3.5 py-2.5">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <p className="text-sm text-slate-400">
              {tabCount} tab{tabCount === 1 ? "" : "s"} active • {activePaneCount} pane{activePaneCount === 1 ? "" : "s"} in focus
            </p>
          </div>
        </div>
      ) : null}
      <TerminalWorkspace launchHost={selectedHost} />
    </section>
  );
}
