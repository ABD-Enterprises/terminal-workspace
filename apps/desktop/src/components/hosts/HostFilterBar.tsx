import { SearchInput } from "../common/SearchInput";

interface HostFilterBarProps {
  query: string;
  groups: string[];
  tags: string[];
  activeGroup: string;
  activeTag: string;
  favoritesOnly: boolean;
  onQueryChange: (value: string) => void;
  onGroupChange: (value: string) => void;
  onTagChange: (value: string) => void;
  onFavoritesToggle: () => void;
}

export function HostFilterBar({
  query,
  groups,
  tags,
  activeGroup,
  activeTag,
  favoritesOnly,
  onQueryChange,
  onGroupChange,
  onTagChange,
  onFavoritesToggle,
}: HostFilterBarProps) {
  return (
    <section className="sticky top-0 z-10 rounded-[20px] border border-slate-800/80 bg-slate-950/85 p-2.5 backdrop-blur-xl">
      <div className="grid gap-2.5 xl:grid-cols-[minmax(0,1.8fr)_minmax(0,180px)_minmax(0,180px)_148px]">
        <SearchInput
          value={query}
          onChange={onQueryChange}
          placeholder="Search hosts, tags, notes, users, or identities"
        />
        <label className="block">
          <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
            Group
          </span>
          <select
            value={activeGroup}
            onChange={(event) => onGroupChange(event.target.value)}
            className="mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-950/70 px-3 py-1.5 text-[13px] text-slate-100 outline-none transition focus:border-emerald-400/60 focus:ring-2 focus:ring-emerald-400/20"
          >
            <option value="all">All groups</option>
            {groups.map((group) => (
              <option key={group} value={group}>
                {group}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
            Tag
          </span>
          <select
            value={activeTag}
            onChange={(event) => onTagChange(event.target.value)}
            className="mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-950/70 px-3 py-1.5 text-[13px] text-slate-100 outline-none transition focus:border-emerald-400/60 focus:ring-2 focus:ring-emerald-400/20"
          >
            <option value="all">All tags</option>
            {tags.map((tag) => (
              <option key={tag} value={tag}>
                {tag}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={onFavoritesToggle}
          className={`rounded-xl border px-3 py-1.5 text-[13px] font-medium transition ${
            favoritesOnly
              ? "border-amber-400/50 bg-amber-400/10 text-amber-100"
              : "border-slate-700 bg-slate-950/60 text-slate-300 hover:border-slate-500 hover:text-white"
          }`}
        >
          Favorites only
        </button>
      </div>
    </section>
  );
}
