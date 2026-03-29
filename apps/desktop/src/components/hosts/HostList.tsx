import { cn, formatHostAddress, formatRelativeTime } from "../../lib/utils";
import type { HostRecord } from "../../types/host";
import { EmptyState } from "../common/EmptyState";

interface HostListProps {
  hosts: HostRecord[];
  hostsById?: Record<string, HostRecord>;
  selectedHostId?: string;
  onSelect: (hostId: string) => void;
  onConnect: (hostId: string) => void;
  onEdit: (hostId: string) => void;
  onDelete: (hostId: string) => void;
  onToggleFavorite: (hostId: string) => void;
  onCreateHost: () => void;
}

export function HostList({
  hosts,
  hostsById = {},
  selectedHostId,
  onSelect,
  onConnect,
  onEdit,
  onDelete,
  onToggleFavorite,
  onCreateHost,
}: HostListProps) {
  if (!hosts.length) {
    return (
      <EmptyState
        title="No hosts match the active filters"
        description="Clear the search, relax the tag or group filter, or create a new host to keep moving."
        action={
          <button
            type="button"
            onClick={onCreateHost}
            className="rounded-2xl bg-emerald-400 px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-emerald-300"
          >
            Add host
          </button>
        }
      />
    );
  }

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-[22px] border border-slate-800/80 bg-slate-950/50">
      <div className="grid grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_116px_104px_100px_136px] gap-3 border-b border-slate-800/80 bg-slate-950/95 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
        <span>Host</span>
        <span>Address</span>
        <span>Identity</span>
        <span>Group</span>
        <span>Last used</span>
        <span className="text-right">Actions</span>
      </div>

      <div className="min-h-0 overflow-auto">
        {hosts.map((host) => {
          const selected = host.id === selectedHostId;

          return (
            <div
              key={host.id}
              className={cn(
                "grid grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_116px_104px_100px_136px] gap-3 border-b border-slate-900/80 px-3 py-2 text-[13px] transition",
                selected ? "bg-emerald-400/10" : "bg-transparent hover:bg-slate-900/70"
              )}
            >
              <button type="button" onClick={() => onSelect(host.id)} className="min-w-0 text-left">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium text-slate-100">{host.label}</span>
                  {host.favorite ? (
                    <span className="rounded-full border border-amber-400/40 bg-amber-400/10 px-1.5 py-0.5 text-[10px] uppercase tracking-[0.12em] text-amber-200">
                      Fav
                    </span>
                  ) : null}
                </div>
                <p className="mt-0.5 truncate text-[11px] text-slate-500">
                  {host.tags.slice(0, 3).join(" · ") || "No tags"}
                </p>
              </button>

              <button type="button" onClick={() => onSelect(host.id)} className="min-w-0 text-left">
                <p className="truncate text-sm text-slate-200">{formatHostAddress(host)}</p>
                <p className="mt-0.5 truncate text-[11px] text-slate-500">
                  {host.authMethod === "privateKey"
                    ? "Private key"
                    : host.authMethod === "password"
                      ? "Password"
                      : "Auth unset"}
                  {" · "}
                  {host.hostKeyPolicy === "requireTrusted" ? "Trusted key required" : "Unknown key allowed"}
                  {host.jumpHostId && hostsById[host.jumpHostId]
                    ? ` · via ${hostsById[host.jumpHostId].label}`
                    : ""}
                  {host.agentForwarding ? " · agent" : ""}
                </p>
              </button>

              <button type="button" onClick={() => onSelect(host.id)} className="min-w-0 text-left">
                <p className="truncate text-sm text-slate-200">{host.keyLabel || "Unassigned"}</p>
                <p className="mt-0.5 text-[11px] text-slate-500">
                  {host.snippetCount} snips · {host.forwardingCount} fwd · {Object.keys(host.environment).length} env
                </p>
              </button>

              <button type="button" onClick={() => onSelect(host.id)} className="min-w-0 text-left">
                <p className="truncate text-sm text-slate-200">{host.group || "Ungrouped"}</p>
              </button>

              <button type="button" onClick={() => onSelect(host.id)} className="min-w-0 text-left">
                <p className="truncate text-sm text-slate-200">
                  {formatRelativeTime(host.lastConnectedAt)}
                </p>
              </button>

              <div className="flex items-center justify-end gap-1">
                <button
                  type="button"
                  onClick={() => onToggleFavorite(host.id)}
                  aria-label={host.favorite ? "Remove favorite" : "Add favorite"}
                  className={cn(
                    "rounded-lg border px-2 py-0.5 text-[11px] transition",
                    host.favorite
                      ? "border-amber-400/50 bg-amber-400/10 text-amber-200"
                      : "border-slate-700 bg-slate-900/80 text-slate-400 hover:text-slate-100"
                  )}
                >
                  ★
                </button>
                <button
                  type="button"
                  onClick={() => onConnect(host.id)}
                  className="rounded-lg bg-emerald-400 px-2.5 py-0.5 text-[11px] font-medium text-slate-950 transition hover:bg-emerald-300"
                >
                  Open
                </button>
                <button
                  type="button"
                  onClick={() => onEdit(host.id)}
                  className="rounded-lg border border-slate-700 px-2.5 py-0.5 text-[11px] text-slate-200 transition hover:border-slate-500 hover:text-white"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(host.id)}
                  className="rounded-lg border border-rose-500/40 px-2.5 py-0.5 text-[11px] text-rose-200 transition hover:border-rose-400 hover:text-white"
                >
                  Del
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
