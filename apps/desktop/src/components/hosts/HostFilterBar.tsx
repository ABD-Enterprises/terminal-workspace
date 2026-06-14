// #108: the single Hosts toolbar. One row merges the filter controls
// (group, tag, favorites), a single host-count summary, and the primary
// actions (Reset filters, Import SSH config, Add host). Search lives in
// the sidebar source list and drives the same `sidebarSearch` store, so
// there is no second search box here. Stacking a stats line, a toolbar,
// and a separate filter bar is what this replaces.

interface HostFilterBarProps {
  groups: string[];
  tags: string[];
  activeGroup: string;
  activeTag: string;
  favoritesOnly: boolean;
  /** Total hosts in the inventory. */
  total: number;
  /** Hosts visible after filters — equals `total` when nothing is filtered. */
  shown: number;
  onGroupChange: (value: string) => void;
  onTagChange: (value: string) => void;
  onFavoritesToggle: () => void;
  onAddHost: () => void;
  onImportSshConfig: () => void;
  onResetFilters: () => void;
}

const selectClass =
  "rounded-lg border border-slate-700 bg-slate-950/70 px-2.5 py-1.5 text-[13px] text-slate-200 outline-none transition focus:border-emerald-400/60 focus:ring-2 focus:ring-emerald-400/20";

export function HostFilterBar({
  groups,
  tags,
  activeGroup,
  activeTag,
  favoritesOnly,
  total,
  shown,
  onGroupChange,
  onTagChange,
  onFavoritesToggle,
  onAddHost,
  onImportSshConfig,
  onResetFilters,
}: HostFilterBarProps) {
  const summary =
    shown === total ? `${total} host${total === 1 ? "" : "s"}` : `${shown} of ${total} hosts`;

  return (
    <section
      aria-label="Host toolbar"
      className="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-[16px] border border-slate-800/80 bg-slate-950/85 px-3 py-2 backdrop-blur-xl"
    >
      <span className="shrink-0 text-[12px] tabular-nums text-slate-500">{summary}</span>
      <span aria-hidden="true" className="hidden h-4 w-px bg-slate-800 sm:block" />

      <select
        aria-label="Filter by group"
        value={activeGroup}
        onChange={(event) => onGroupChange(event.target.value)}
        className={selectClass}
      >
        <option value="all">All groups</option>
        {groups.map((group) => (
          <option key={group} value={group}>
            {group}
          </option>
        ))}
      </select>
      <select
        aria-label="Filter by tag"
        value={activeTag}
        onChange={(event) => onTagChange(event.target.value)}
        className={selectClass}
      >
        <option value="all">All tags</option>
        {tags.map((tag) => (
          <option key={tag} value={tag}>
            {tag}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={onFavoritesToggle}
        aria-pressed={favoritesOnly}
        className={`rounded-lg border px-2.5 py-1.5 text-[13px] font-medium transition ${
          favoritesOnly
            ? "border-amber-400/50 bg-amber-400/10 text-amber-100"
            : "border-slate-700 bg-slate-950/60 text-slate-300 hover:border-slate-500 hover:text-white"
        }`}
      >
        Favorites only
      </button>

      <div className="ml-auto flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onResetFilters}
          className="rounded-lg border border-slate-700 px-3 py-1.5 text-[13px] text-slate-200 transition hover:border-slate-500 hover:text-white"
        >
          Reset filters
        </button>
        <button
          type="button"
          onClick={onImportSshConfig}
          className="rounded-lg border border-slate-700 px-3 py-1.5 text-[13px] font-medium text-slate-200 transition hover:border-slate-500 hover:text-white"
        >
          Import SSH config
        </button>
        <button
          type="button"
          onClick={onAddHost}
          className="rounded-lg bg-emerald-400 px-3 py-1.5 text-[13px] font-medium text-slate-950 transition hover:bg-emerald-300"
        >
          Add host
        </button>
      </div>
    </section>
  );
}
