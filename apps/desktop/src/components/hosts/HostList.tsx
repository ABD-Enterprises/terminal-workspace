import { Fragment, type ReactNode } from "react";
import {
  deriveHostConnectionStatus,
  statusDotAriaLabel,
  statusDotClass,
} from "../../lib/host-status";
import { cn, describeHostRuntime, formatHostAddress, formatRelativeTime } from "../../lib/utils";
import { useSessionsStore } from "../../store/sessions-store";
import { formatHostProtocol, type HostRecord } from "../../types/host";
import { EmptyState } from "../common/EmptyState";

function getVisibleTags(tags: string[]) {
  return tags.filter((tag) => tag.trim().toLowerCase() !== "favorite");
}

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
  renderExpandedContent?: (host: HostRecord) => ReactNode;
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
  renderExpandedContent,
}: HostListProps) {
  // T07: per-host connection status dot. Subscribe to the pane map so
  // dot colors re-render in real time when a session moves through
  // connecting → connected → disconnected.
  const sessionPanes = useSessionsStore((state) => state.panes);
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
      <div className="grid grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_116px_104px_100px_180px] gap-3 border-b border-slate-800/80 bg-slate-950/95 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">
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
          const visibleTags = getVisibleTags(host.tags);
          const status = deriveHostConnectionStatus(host.id, sessionPanes);

          return (
            <Fragment key={host.id}>
              <div
                className={cn(
                  "grid grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_116px_104px_100px_180px] gap-3 border-b border-slate-900/80 px-3 py-2 text-[13px] transition",
                  selected ? "bg-emerald-400/10" : "bg-transparent hover:bg-slate-900/70"
                )}
              >
                {/*
                  #104: favorite is a quiet LEADING affordance — a sibling of
                  the select button, never inside the destructive action
                  cluster. Ghost style (no border); amber only when active.
                */}
                <div className="flex min-w-0 items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => onToggleFavorite(host.id)}
                    aria-label={host.favorite ? "Remove favorite" : "Add favorite"}
                    aria-pressed={host.favorite}
                    className={cn(
                      "flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-sm transition",
                      host.favorite
                        ? "text-amber-300 hover:text-amber-200"
                        : "text-slate-500 hover:text-slate-300"
                    )}
                  >
                    {host.favorite ? "★" : "☆"}
                  </button>
                  <button type="button" onClick={() => onSelect(host.id)} className="min-w-0 text-left">
                    <span className="flex items-center gap-2">
                      <span
                        aria-label={statusDotAriaLabel(status)}
                        role="img"
                        data-testid="host-status-dot"
                        data-status={status}
                        className={cn(
                          "h-1.5 w-1.5 shrink-0 rounded-full",
                          statusDotClass(status)
                        )}
                      />
                      <span className="block truncate font-medium text-slate-100">{host.label}</span>
                    </span>
                    <p className="mt-0.5 truncate text-[11px] text-slate-400">
                      {[formatHostProtocol(host.protocol), ...visibleTags].slice(0, 3).join(" · ") || "No tags"}
                    </p>
                  </button>
                </div>

                <button type="button" onClick={() => onSelect(host.id)} className="min-w-0 text-left">
                  <p className="truncate text-sm text-slate-200">{formatHostAddress(host)}</p>
                  <p className="mt-0.5 truncate text-[11px] text-slate-400">
                    {describeHostRuntime(
                      host,
                      host.jumpHostId && hostsById[host.jumpHostId]
                        ? hostsById[host.jumpHostId].label
                        : undefined
                    )}
                  </p>
                </button>

                <button type="button" onClick={() => onSelect(host.id)} className="min-w-0 text-left">
                  <p className="truncate text-sm text-slate-200">{host.keyLabel || "Unassigned"}</p>
                  <p className="mt-0.5 text-[11px] text-slate-400">
                    {host.protocol === "ssh"
                      ? `${host.snippetCount} snips · ${host.forwardingCount} fwd · ${Object.keys(host.environment).length} env`
                      : `${Object.keys(host.environment).length} env · ${formatHostProtocol(host.protocol)}`}
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

                {/*
                  #104: actions are Open / Edit / Delete only (favorite moved
                  to the leading affordance above). 8px gaps, ~28px tall hit
                  targets. Delete is de-emphasised (quiet ghost, brightens to
                  rose only on hover) and pushed apart from the primary Open
                  with an extra left margin so a misclick can't destroy a host.
                */}
                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => onConnect(host.id)}
                    className="rounded-lg bg-emerald-400 px-3 py-1.5 text-xs font-medium text-slate-950 transition hover:bg-emerald-300"
                  >
                    Open
                  </button>
                  <button
                    type="button"
                    onClick={() => onEdit(host.id)}
                    className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-200 transition hover:border-slate-500 hover:text-white"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete(host.id)}
                    aria-label={`Delete ${host.label}`}
                    className="ml-1 rounded-lg px-2.5 py-1.5 text-xs text-slate-400 transition hover:bg-rose-500/10 hover:text-rose-200"
                  >
                    Delete
                  </button>
                </div>
              </div>

              {selected && renderExpandedContent ? (
                <div className="border-b border-slate-900/80 bg-slate-950/70 px-3 pb-3">
                  <div className="rounded-[18px] border border-emerald-400/20 bg-slate-950/70 p-3">
                    {renderExpandedContent(host)}
                  </div>
                </div>
              ) : null}
            </Fragment>
          );
        })}
      </div>
    </section>
  );
}
