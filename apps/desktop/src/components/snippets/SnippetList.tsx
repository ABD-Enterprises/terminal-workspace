import { formatRelativeTime } from "../../lib/utils";
import type { HostRecord } from "../../types/host";
import type { SnippetRecord } from "../../types/snippet";

interface SnippetListProps {
  snippets: SnippetRecord[];
  hostsById: Record<string, HostRecord>;
  selectedSnippetId?: string;
  onSelect: (snippetId: string) => void;
  onDuplicate: (snippetId: string) => void;
  onDelete: (snippetId: string) => void;
}

export function SnippetList({
  snippets,
  hostsById,
  selectedSnippetId,
  onSelect,
  onDuplicate,
  onDelete,
}: SnippetListProps) {
  if (!snippets.length) {
    return (
      <div className="rounded-[20px] border border-dashed border-slate-700/80 bg-slate-950/40 px-4 py-10 text-center text-sm text-slate-500">
        Create a saved command to start building a reusable snippet library.
      </div>
    );
  }

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-[22px] border border-slate-800/80 bg-slate-950/55">
      <div className="grid grid-cols-[minmax(0,1.2fr)_160px_120px_96px] gap-3 border-b border-slate-800/80 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
        <span>Snippet</span>
        <span>Targets</span>
        <span>Last run</span>
        <span className="text-right">Manage</span>
      </div>

      <div className="min-h-0 overflow-auto">
        {snippets.map((snippet) => (
          <div
            key={snippet.id}
            className={`grid grid-cols-[minmax(0,1.2fr)_160px_120px_96px] gap-3 border-b border-slate-900/80 px-3 py-2 text-sm transition ${
              snippet.id === selectedSnippetId ? "bg-emerald-400/10" : "hover:bg-slate-900/70"
            }`}
          >
            <button type="button" onClick={() => onSelect(snippet.id)} className="min-w-0 text-left">
              <p className="truncate font-medium text-slate-100">{snippet.title}</p>
              <p className="mt-0.5 truncate text-[11px] text-slate-500">
                {snippet.tags.join(" · ") || "No tags"}
              </p>
            </button>

            <button type="button" onClick={() => onSelect(snippet.id)} className="min-w-0 text-left">
              <p className="truncate text-sm text-slate-200">
                {snippet.targetHostIds.length
                  ? snippet.targetHostIds
                      .map((hostId) => hostsById[hostId]?.label ?? hostId)
                      .slice(0, 2)
                      .join(", ")
                  : "Manual"}
              </p>
              <p className="mt-0.5 text-[11px] text-slate-500">
                {snippet.targetHostIds.length} default host{snippet.targetHostIds.length === 1 ? "" : "s"}
              </p>
            </button>

            <button type="button" onClick={() => onSelect(snippet.id)} className="min-w-0 text-left">
              <p className="truncate text-sm text-slate-200">{formatRelativeTime(snippet.lastRunAt)}</p>
            </button>

            <div className="flex items-center justify-end gap-1">
              <button
                type="button"
                onClick={() => onDuplicate(snippet.id)}
                className="rounded-lg border border-slate-700 px-2.5 py-1 text-[11px] text-slate-200 transition hover:border-slate-500 hover:text-white"
              >
                Copy
              </button>
              <button
                type="button"
                onClick={() => onDelete(snippet.id)}
                className="rounded-lg border border-rose-500/40 px-2.5 py-1 text-[11px] text-rose-200 transition hover:border-rose-400 hover:text-white"
              >
                Del
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
