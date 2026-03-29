import { formatBytes, formatRelativeTime } from "../../lib/utils";
import type { TransferItem } from "../../types/transfer";

interface TransferQueueProps {
  items: TransferItem[];
  onClearCompleted: () => void;
}

const statusStyles = {
  queued: "border-slate-700 bg-slate-950/80 text-slate-300",
  running: "border-amber-400/40 bg-amber-400/10 text-amber-100",
  completed: "border-emerald-400/40 bg-emerald-400/10 text-emerald-100",
  failed: "border-rose-400/40 bg-rose-400/10 text-rose-100",
} as const;

export function TransferQueue({ items, onClearCompleted }: TransferQueueProps) {
  return (
    <section className="flex h-full min-h-0 flex-col rounded-[22px] border border-slate-800/80 bg-slate-950/50">
      <div className="flex items-center justify-between gap-3 border-b border-slate-800/80 px-3.5 py-2.5">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
            Transfer queue
          </p>
          <p className="mt-0.5 text-[11px] text-slate-400">Recent uploads and downloads stay visible here.</p>
        </div>
        <button
          type="button"
          onClick={onClearCompleted}
          className="rounded-lg border border-slate-700 px-3 py-1 text-xs text-slate-300 transition hover:border-slate-500 hover:text-white"
        >
          Clear done
        </button>
      </div>

      <div className="min-h-0 space-y-1.5 overflow-auto px-3 py-2.5">
        {items.length ? (
          items.map((item) => (
            <article
              key={item.id}
              className="rounded-[16px] border border-slate-800/80 bg-slate-950/70 p-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-100">{item.name}</p>
                  <p className="mt-1 truncate text-xs text-slate-500">{item.remotePath}</p>
                </div>
                <span
                  className={`rounded-full border px-2 py-1 text-[10px] uppercase tracking-[0.18em] ${statusStyles[item.status]}`}
                >
                  {item.status}
                </span>
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
                <span className="rounded-full border border-slate-800 bg-slate-900/80 px-2 py-1">
                  {item.direction}
                </span>
                <span>{item.hostLabel}</span>
                <span>{formatBytes(item.bytes)}</span>
                <span>{formatRelativeTime(item.updatedAt)}</span>
              </div>

              {item.errorMessage ? (
                <p className="mt-2 text-xs leading-5 text-rose-200">{item.errorMessage}</p>
              ) : null}
            </article>
          ))
        ) : (
          <div className="rounded-[18px] border border-dashed border-slate-700/80 bg-slate-950/40 px-4 py-8 text-center text-sm text-slate-500">
            No transfer activity yet.
          </div>
        )}
      </div>
    </section>
  );
}
