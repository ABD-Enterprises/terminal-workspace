import type { HostRecord } from "../../types/host";
import { cn, formatHostAddress, formatRelativeTime } from "../../lib/utils";

interface HostCardProps {
  host: HostRecord;
  selected: boolean;
  onSelect: () => void;
  onConnect: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onToggleFavorite: () => void;
}

export function HostCard({
  host,
  selected,
  onSelect,
  onConnect,
  onEdit,
  onDelete,
  onToggleFavorite,
}: HostCardProps) {
  return (
    <article
      className={cn(
        "rounded-[28px] border p-5 transition",
        selected
          ? "border-emerald-400/50 bg-emerald-400/10 shadow-lg shadow-emerald-950/20"
          : "border-slate-800/90 bg-slate-950/40 hover:border-slate-600 hover:bg-slate-900/80"
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <button type="button" onClick={onSelect} className="min-w-0 flex-1 text-left">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
            {host.group || "Ungrouped"}
          </p>
          <h3 className="mt-2 truncate text-lg font-semibold text-slate-50">{host.label}</h3>
          <p className="mt-1 text-sm text-slate-300">{formatHostAddress(host)}</p>
        </button>
        <button
          type="button"
          onClick={onToggleFavorite}
          aria-label={host.favorite ? "Remove favorite" : "Add favorite"}
          className={cn(
            "rounded-2xl border px-3 py-2 text-sm transition",
            host.favorite
              ? "border-amber-400/60 bg-amber-400/10 text-amber-200"
              : "border-slate-700 bg-slate-900/70 text-slate-400 hover:text-slate-100"
          )}
        >
          ★
        </button>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {host.tags.map((tag) => (
          <span
            key={tag}
            className="rounded-full border border-slate-700 bg-slate-900/80 px-2.5 py-1 text-xs text-slate-300"
          >
            {tag}
          </span>
        ))}
      </div>

      <p className="mt-4 line-clamp-2 text-sm leading-6 text-slate-400">{host.note}</p>

      <dl className="mt-5 grid grid-cols-3 gap-3 rounded-2xl border border-slate-800 bg-slate-950/50 p-3 text-sm">
        <div>
          <dt className="text-xs uppercase tracking-[0.2em] text-slate-500">Snippets</dt>
          <dd className="mt-1 font-semibold text-slate-100">{host.snippetCount}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-[0.2em] text-slate-500">Forwards</dt>
          <dd className="mt-1 font-semibold text-slate-100">{host.forwardingCount}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-[0.2em] text-slate-500">Last used</dt>
          <dd className="mt-1 font-semibold text-slate-100">{formatRelativeTime(host.lastConnectedAt)}</dd>
        </div>
      </dl>

      <div className="mt-5 flex items-center justify-between gap-2">
        <span className="text-xs uppercase tracking-[0.24em] text-slate-500">{host.keyLabel || "No key assigned"}</span>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onConnect}
            className="rounded-2xl bg-emerald-400 px-3 py-2 text-sm font-medium text-slate-950 transition hover:bg-emerald-300"
          >
            Connect
          </button>
          <button
            type="button"
            onClick={onEdit}
            className="rounded-2xl border border-slate-700 px-3 py-2 text-sm text-slate-200 transition hover:border-slate-500 hover:text-white"
          >
            Edit
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="rounded-2xl border border-rose-500/40 px-3 py-2 text-sm text-rose-200 transition hover:border-rose-400 hover:text-white"
          >
            Delete
          </button>
        </div>
      </div>
    </article>
  );
}
