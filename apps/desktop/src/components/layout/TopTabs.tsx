import { NavLink } from "react-router-dom";
import { navigationItems } from "../../lib/navigation";
import { formatPrimaryShortcut } from "../../lib/shortcuts";
import { cn } from "../../lib/utils";
import { useAppStore } from "../../store/app-store";

export function TopTabs() {
  const openCommandPalette = useAppStore((state) => state.openCommandPalette);
  const workspaceDensity = useAppStore((state) => state.workspaceDensity);
  const sectionShortcutsEnabled = useAppStore((state) => state.sectionShortcutsEnabled);

  return (
    <div
      className={cn(
        "border-b border-slate-800/80 bg-slate-950/75 backdrop-blur-xl",
        workspaceDensity === "compact" ? "px-2.5 py-1.5" : "px-3 py-2"
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto">
          {navigationItems.map((item, index) => (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) =>
                cn(
                  "shrink-0 rounded-lg border px-2.5 py-1 text-[12px] transition",
                  isActive
                    ? "border-emerald-400/50 bg-emerald-400/10 text-emerald-100"
                    : "border-slate-800 bg-slate-900/70 text-slate-300 hover:border-slate-700 hover:text-white"
                )
              }
            >
              <span className="flex items-center gap-2">
                <span>{item.label}</span>
                {sectionShortcutsEnabled ? (
                  <span className="rounded-full border border-slate-700/80 bg-slate-950/80 px-1.5 py-0.5 text-[10px] text-slate-400">
                    {formatPrimaryShortcut(String(index + 1))}
                  </span>
                ) : null}
              </span>
            </NavLink>
          ))}
        </div>
        <button
          type="button"
          onClick={openCommandPalette}
          className="rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-1 text-[12px] text-slate-200 transition hover:border-slate-500 hover:text-white"
        >
          Command Palette {formatPrimaryShortcut("k")}
        </button>
      </div>
    </div>
  );
}
