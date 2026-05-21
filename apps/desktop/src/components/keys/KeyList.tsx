import { Fragment, type ReactNode } from "react";
import type { HostRecord } from "../../types/host";
import type { KeyRecord } from "../../types/key";

interface KeyListProps {
  keys: KeyRecord[];
  hosts: Record<string, HostRecord>;
  selectedKeyId?: string;
  onSelect: (keyId: string) => void;
  onDelete: (keyId: string) => void;
  /**
   * T12: open the Copy-to-host dialog for this key. When omitted the
   * button is hidden — used by tests that don't exercise the ssh-copy-id
   * flow.
   */
  onCopyToHost?: (keyId: string) => void;
  renderExpandedContent?: (key: KeyRecord) => ReactNode;
}

export function KeyList({
  keys,
  hosts,
  selectedKeyId,
  onSelect,
  onDelete,
  onCopyToHost,
  renderExpandedContent,
}: KeyListProps) {
  if (!keys.length) {
    return (
      <div className="rounded-[20px] border border-dashed border-slate-700/80 bg-slate-950/40 px-4 py-10 text-center text-sm text-slate-500">
        Import an existing private key or generate a new one to build a local identity catalog.
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-[22px] border border-slate-800/80 bg-slate-950/65">
      <div className="grid grid-cols-[minmax(0,1.2fr)_90px_160px_120px_180px] gap-3 border-b border-slate-800/80 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
        <span>Identity</span>
        <span>Bits</span>
        <span>Fingerprint</span>
        <span>Assignments</span>
        <span>Manage</span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {keys.map((key) => {
          const selected = key.id === selectedKeyId;

          return (
            <Fragment key={key.id}>
              <div
                className={`grid grid-cols-[minmax(0,1.2fr)_90px_160px_120px_180px] gap-3 border-b border-slate-900/80 px-3 py-2 text-sm ${
                  selected ? "bg-emerald-400/10" : "bg-transparent hover:bg-slate-900/70"
                }`}
              >
                <button type="button" onClick={() => onSelect(key.id)} className="min-w-0 text-left">
                  <p className="truncate font-medium text-slate-100">{key.label}</p>
                  <p className="mt-0.5 truncate text-[11px] text-slate-500">
                    {key.algorithm} · {key.privateKeyPath}
                  </p>
                </button>

                <button type="button" onClick={() => onSelect(key.id)} className="min-w-0 text-left text-xs text-slate-300">
                  {key.bits || "—"}
                </button>
                <button type="button" onClick={() => onSelect(key.id)} className="min-w-0 truncate text-left text-xs text-slate-300">
                  {key.fingerprint || "—"}
                </button>
                <button type="button" onClick={() => onSelect(key.id)} className="min-w-0 truncate text-left text-xs text-slate-300">
                  {key.assignedHostIds.length
                    ? key.assignedHostIds.map((hostId) => hosts[hostId]?.label ?? hostId).join(", ")
                    : "Unassigned"}
                </button>
                <div className="flex items-center justify-end gap-1.5">
                  {onCopyToHost ? (
                    <button
                      type="button"
                      onClick={() => onCopyToHost(key.id)}
                      className="rounded-lg border border-slate-700 px-2.5 py-1 text-xs text-slate-200 transition hover:border-slate-500 hover:text-white"
                    >
                      Copy to host…
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => onDelete(key.id)}
                    className="rounded-lg border border-rose-500/40 px-2.5 py-1 text-xs text-rose-200 transition hover:border-rose-400 hover:text-white"
                  >
                    Delete
                  </button>
                </div>
              </div>

              {selected && renderExpandedContent ? (
                <div className="border-b border-slate-900/80 bg-slate-950/70 px-3 pb-3">
                  <div className="rounded-[18px] border border-emerald-400/20 bg-slate-950/70 p-3">
                    {renderExpandedContent(key)}
                  </div>
                </div>
              ) : null}
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}
