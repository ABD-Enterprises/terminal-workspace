import { NavLink } from "react-router-dom";
import { navigationItems } from "../../lib/navigation";
import { cn } from "../../lib/utils";
import { useAppStore } from "../../store/app-store";
import { useHostsStore } from "../../store/hosts-store";
import { SearchInput } from "../common/SearchInput";

export function Sidebar() {
  const hosts = useHostsStore((state) => state.hosts);
  const sidebarSearch = useAppStore((state) => state.sidebarSearch);
  const setSidebarSearch = useAppStore((state) => state.setSidebarSearch);
  const workspaceDensity = useAppStore((state) => state.workspaceDensity);
  const favoriteCount = hosts.filter((host) => host.favorite).length;
  const groupCount = new Set(hosts.map((host) => host.group).filter(Boolean)).size;

  return (
    <aside
      className={cn(
        "flex shrink-0 flex-col border-r border-slate-800/80 bg-slate-950/85 backdrop-blur-xl",
        workspaceDensity === "compact" ? "w-[226px] px-2 py-2" : "w-[244px] px-2.5 py-2.5"
      )}
    >
      <div
        className={cn(
          "rounded-[18px] border border-slate-800/90 bg-slate-900/60",
          workspaceDensity === "compact" ? "px-3 py-2" : "px-3.5 py-2.5"
        )}
      >
        <p className="text-[10px] font-semibold uppercase tracking-[0.26em] text-emerald-300">
          TermSnip
        </p>
        <h1 className="mt-0.5 text-base font-semibold text-slate-50">Local Vault</h1>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-400">
          <span>{hosts.length} hosts</span>
          <span>•</span>
          <span>{favoriteCount} favorites</span>
          <span>•</span>
          <span>{groupCount} groups</span>
        </div>
      </div>

      <div className="mt-2">
        <SearchInput
          value={sidebarSearch}
          onChange={setSidebarSearch}
          placeholder="Search the host inventory"
        />
      </div>

      <nav className={cn("mt-2", workspaceDensity === "compact" ? "space-y-1" : "space-y-1.5")}>
        {navigationItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            className={({ isActive }) =>
              cn(
                "flex items-center justify-between rounded-[14px] border transition",
                workspaceDensity === "compact" ? "px-2.5 py-1.5" : "px-3 py-2",
                isActive
                  ? "border-emerald-400/50 bg-emerald-400/10"
                  : "border-slate-800 bg-slate-900/70 hover:border-slate-700 hover:bg-slate-900"
              )
            }
          >
            <span className="min-w-0">
              <span className="block text-[13px] font-medium text-slate-100">{item.label}</span>
              <span className="mt-0.5 block truncate text-[10px] leading-4 text-slate-500">
                {item.description}
              </span>
            </span>
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
