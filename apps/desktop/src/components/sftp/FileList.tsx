import { formatBytes, formatTimestamp } from "../../lib/utils";
import type { RemoteFileEntry } from "../../types/transfer";

interface FileListProps {
  currentPath: string;
  entries: RemoteFileEntry[];
  selectedPath?: string;
  onNavigateUp: () => void;
  onSelect: (entry: RemoteFileEntry) => void;
  onOpen: (entry: RemoteFileEntry) => void;
}

export function FileList({
  currentPath,
  entries,
  selectedPath,
  onNavigateUp,
  onSelect,
  onOpen,
}: FileListProps) {
  return (
    <div className="overflow-hidden rounded-[22px] border border-slate-800/80 bg-slate-950/65">
      <div className="grid grid-cols-[minmax(0,1.8fr)_92px_132px_72px] gap-3 border-b border-slate-800/80 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
        <span>Name</span>
        <span>Size</span>
        <span>Modified</span>
        <span>Perms</span>
      </div>

      <div className="max-h-[460px] overflow-auto">
        {currentPath !== "/" ? (
          <button
            type="button"
            onClick={onNavigateUp}
            className="grid w-full grid-cols-[minmax(0,1.8fr)_92px_132px_72px] gap-3 border-b border-slate-900/80 px-3 py-2 text-left text-sm text-slate-300 transition hover:bg-slate-900/80"
          >
            <span className="font-medium text-slate-100">..</span>
            <span>—</span>
            <span>Parent</span>
            <span>—</span>
          </button>
        ) : null}

        {entries.length ? (
          entries.map((entry) => {
            const selected = entry.path === selectedPath;

            return (
              <button
                key={entry.path}
                type="button"
                onClick={() => onSelect(entry)}
                onDoubleClick={() => onOpen(entry)}
                className={`grid w-full grid-cols-[minmax(0,1.8fr)_92px_132px_72px] gap-3 border-b border-slate-900/80 px-3 py-2 text-left text-sm transition ${
                  selected
                    ? "bg-emerald-400/10 text-slate-100"
                    : "text-slate-300 hover:bg-slate-900/80"
                }`}
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium text-slate-100">
                    {entry.kind === "directory" ? "▸" : "·"} {entry.name}
                  </span>
                  <span className="mt-0.5 block text-xs text-slate-500">{entry.path}</span>
                </span>
                <span className="text-xs text-slate-400">
                  {entry.kind === "directory" ? "Folder" : formatBytes(entry.size)}
                </span>
                <span className="text-xs text-slate-400">{formatTimestamp(entry.modifiedAt)}</span>
                <span className="text-xs text-slate-400">{entry.permissions ?? "—"}</span>
              </button>
            );
          })
        ) : (
          <div className="px-4 py-10 text-center text-sm text-slate-500">Directory is empty.</div>
        )}
      </div>
    </div>
  );
}
