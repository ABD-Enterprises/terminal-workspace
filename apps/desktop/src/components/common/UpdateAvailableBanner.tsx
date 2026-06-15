// #97: top-of-page "update available" banner. Driven entirely by app-store
// state (Option 2): useAutoUpdateCheck writes the check result into the store
// and this renders when an available, versioned update hasn't been dismissed.
// Today the updater is a stub (returns available:false), so the banner stays
// hidden for real users until the real tauri-plugin-updater lands (#86) — no
// dead UI is shown. The store-driven design makes it fully testable without a
// working updater.

import { installUpdateAndRestart } from "../../lib/auto-update";
import { shouldShowUpdateBanner, useAppStore } from "../../store/app-store";

export function UpdateAvailableBanner() {
  const updateResult = useAppStore((state) => state.updateResult);
  const dismissedUpdateVersion = useAppStore((state) => state.dismissedUpdateVersion);
  const dismissUpdate = useAppStore((state) => state.dismissUpdate);

  if (!shouldShowUpdateBanner(updateResult, dismissedUpdateVersion)) {
    return null;
  }

  return (
    <div
      role="status"
      aria-label="Update available"
      className="flex flex-wrap items-center justify-between gap-3 border-b border-emerald-400/40 bg-emerald-400/10 px-4 py-2"
    >
      <p className="text-callout font-medium text-emerald-100">
        Update {updateResult?.version} available — install and restart to get the latest.
      </p>
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={() => void installUpdateAndRestart()}
          className="rounded-control bg-emerald-400 px-3 py-1 text-callout font-medium text-slate-950 transition hover:bg-emerald-300"
        >
          Install and restart
        </button>
        <button
          type="button"
          onClick={dismissUpdate}
          className="rounded-control border border-slate-700 px-3 py-1 text-callout text-slate-200 transition hover:border-slate-500 hover:text-white"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
