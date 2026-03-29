import type { HostRecord } from "../../types/host";
import type { KeyRecord } from "../../types/key";

interface KeyListProps {
  keys: KeyRecord[];
  hosts: Record<string, HostRecord>;
  selectedKeyId?: string;
  onSelect: (keyId: string) => void;
  onDelete: (keyId: string) => void;
}

export function KeyList({ keys, hosts, selectedKeyId, onSelect, onDelete }: KeyListProps) {
  if (!keys.length) {
    return (
      <div className="rounded-[20px] border border-dashed border-slate-700/80 bg-slate-950/40 px-4 py-10 text-center text-sm text-slate-500">
        Import an existing private key or generate a new one to build a local identity catalog.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-[22px] border border-slate-800/80 bg-slate-950/65">
      <div className="grid grid-cols-[minmax(0,1.2fr)_90px_160px_120px_80px] gap-3 border-b border-slate-800/80 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
        <span>Identity</span>
        <span>Bits</span>
        <span>Fingerprint</span>
        <span>Assignments</span>
        <span>Manage</span>
      </div>
      <div className="max-h-[420px] overflow-auto">
        {keys.map((key) => (
          <div
            key={key.id}
            className={`grid grid-cols-[minmax(0,1.2fr)_90px_160px_120px_80px] gap-3 border-b border-slate-900/80 px-3 py-2 text-sm ${
              key.id === selectedKeyId ? "bg-emerald-400/10" : "bg-transparent"
            }`}
          >
            <button type="button" onClick={() => onSelect(key.id)} className="min-w-0 text-left">
              <p className="truncate font-medium text-slate-100">{key.label}</p>
              <p className="mt-0.5 truncate text-[11px] text-slate-500">
                {key.algorithm} · {key.privateKeyPath}
              </p>
            </button>

            <div className="text-xs text-slate-300">{key.bits || "—"}</div>
            <div className="truncate text-xs text-slate-300">{key.fingerprint || "—"}</div>
            <div className="text-xs text-slate-300">
              {key.assignedHostIds.length
                ? key.assignedHostIds.map((hostId) => hosts[hostId]?.label ?? hostId).join(", ")
                : "Unassigned"}
            </div>
            <button
              type="button"
              onClick={() => onDelete(key.id)}
              className="rounded-lg border border-rose-500/40 px-3 py-1 text-xs text-rose-200 transition hover:border-rose-400 hover:text-white"
            >
              Delete
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
