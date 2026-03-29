import { cn } from "../../lib/utils";
import type { HostRecord } from "../../types/host";
import type { SessionPane, SessionTab } from "../../types/session";

interface TerminalTabViewProps {
  tabs: SessionTab[];
  panes: Record<string, SessionPane>;
  hosts: Record<string, HostRecord>;
  activeTabId?: string;
  onSelect: (tabId: string) => void;
  onClose: (tabId: string) => void;
}

export function TerminalTabView({
  tabs,
  panes,
  hosts,
  activeTabId,
  onSelect,
  onClose,
}: TerminalTabViewProps) {
  return (
    <div className="flex gap-1.5 overflow-x-auto pb-0.5">
      {tabs.map((tab) => {
        const activePane = panes[tab.activePaneId];
        const host = hosts[tab.hostId];

        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onSelect(tab.id)}
            className={cn(
              "group flex shrink-0 items-center gap-2.5 rounded-[16px] border px-2.5 py-1.5 text-left transition",
              tab.id === activeTabId
                ? "border-emerald-400/50 bg-emerald-400/10"
                : "border-slate-800 bg-slate-950/50 hover:border-slate-700 hover:bg-slate-900/80"
            )}
          >
            <span
              className={cn(
                "h-2.5 w-2.5 rounded-full",
                activePane?.connectionState === "connected" && "bg-emerald-300",
                activePane?.connectionState === "connecting" && "bg-amber-300",
                activePane?.connectionState === "pendingSecrets" && "bg-cyan-300",
                activePane?.connectionState === "disconnected" && "bg-slate-500",
                activePane?.connectionState === "error" && "bg-rose-300"
              )}
            />
            <span className="min-w-0">
              <span className="block truncate text-[13px] font-medium text-slate-100">{tab.title}</span>
              <span className="mt-0.5 block truncate text-[11px] text-slate-500">
                {tab.paneIds.length} pane{tab.paneIds.length === 1 ? "" : "s"} • {host?.hostname}
              </span>
            </span>
            <span
              role="button"
              tabIndex={0}
              onClick={(event) => {
                event.stopPropagation();
                onClose(tab.id);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onClose(tab.id);
                }
              }}
              className="rounded-full border border-slate-700 px-2 py-0.5 text-[10px] text-slate-400 transition group-hover:border-slate-500 group-hover:text-white"
            >
              Close
            </span>
          </button>
        );
      })}
    </div>
  );
}
