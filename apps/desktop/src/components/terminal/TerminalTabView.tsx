import { useState } from "react";
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
  /**
   * Bonus parity round: drag-and-drop tab reorder. Wired through to
   * `useSessionsStore.reorderTab` (which is a no-op for out-of-range or
   * identity moves). When omitted, tabs are not draggable — used by
   * snapshot tests that don't care about reorder state.
   */
  onReorder?: (fromIndex: number, toIndex: number) => void;
}

const DRAG_DATA_KEY = "application/x-termsnip-tab-index";

export function TerminalTabView({
  tabs,
  panes,
  hosts,
  activeTabId,
  onSelect,
  onClose,
  onReorder,
}: TerminalTabViewProps) {
  const [dragSourceIndex, setDragSourceIndex] = useState<number | null>(null);
  const [dragTargetIndex, setDragTargetIndex] = useState<number | null>(null);
  const draggable = Boolean(onReorder);

  const handleDragStart = (event: React.DragEvent, index: number) => {
    if (!draggable) {
      return;
    }
    setDragSourceIndex(index);
    event.dataTransfer.setData(DRAG_DATA_KEY, String(index));
    event.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (event: React.DragEvent, index: number) => {
    if (!draggable) {
      return;
    }
    if (!event.dataTransfer.types.includes(DRAG_DATA_KEY)) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDragTargetIndex(index);
  };

  const handleDrop = (event: React.DragEvent, index: number) => {
    if (!draggable) {
      return;
    }
    event.preventDefault();
    const raw = event.dataTransfer.getData(DRAG_DATA_KEY);
    const fromIndex = Number.parseInt(raw, 10);
    if (Number.isFinite(fromIndex)) {
      onReorder?.(fromIndex, index);
    }
    setDragSourceIndex(null);
    setDragTargetIndex(null);
  };

  const handleDragEnd = () => {
    setDragSourceIndex(null);
    setDragTargetIndex(null);
  };

  return (
    <div className="flex gap-1.5 overflow-x-auto pb-0.5">
      {tabs.map((tab, index) => {
        const activePane = panes[tab.activePaneId];
        const host = hosts[tab.hostId];
        const isDragSource = dragSourceIndex === index;
        const isDragTarget =
          dragTargetIndex === index && dragSourceIndex !== null && dragSourceIndex !== index;

        return (
          <button
            key={tab.id}
            type="button"
            draggable={draggable}
            onDragStart={(event) => handleDragStart(event, index)}
            onDragOver={(event) => handleDragOver(event, index)}
            onDrop={(event) => handleDrop(event, index)}
            onDragEnd={handleDragEnd}
            onClick={() => onSelect(tab.id)}
            className={cn(
              "group flex shrink-0 items-center gap-2.5 rounded-[16px] border px-2.5 py-1.5 text-left transition",
              tab.id === activeTabId
                ? "border-emerald-400/50 bg-emerald-400/10"
                : "border-slate-800 bg-slate-950/50 hover:border-slate-700 hover:bg-slate-900/80",
              isDragSource && "opacity-40",
              isDragTarget && "border-emerald-300 ring-2 ring-emerald-300/40"
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
