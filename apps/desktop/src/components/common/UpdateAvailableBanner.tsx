// #97: top-of-page "update available" banner. Driven entirely by app-store
// state (Option 2): useAutoUpdateCheck writes the check result into the store
// and this renders when an available, versioned update hasn't been dismissed.
// Today the updater is a stub (returns available:false), so the banner stays
// hidden for real users until the real tauri-plugin-updater lands (#86) — no
// dead UI is shown. The store-driven design makes it fully testable without a
// working updater.

import { useState } from "react";
import {
  installUpdateAndRestart,
  parseLiveSessionRefusal,
} from "../../lib/auto-update";
import { shouldShowUpdateBanner, useAppStore } from "../../store/app-store";

export function UpdateAvailableBanner() {
  const updateResult = useAppStore((state) => state.updateResult);
  const dismissedUpdateVersion = useAppStore((state) => state.dismissedUpdateVersion);
  const dismissUpdate = useAppStore((state) => state.dismissUpdate);
  // #148: null until the install is refused because sessions are live; then it
  // holds the count so the user is told what they are about to lose.
  const [liveSessionCount, setLiveSessionCount] = useState<number | null>(null);
  const [installError, setInstallError] = useState<string | null>(null);
  // #148: install is async and ends in a process restart. Without this, a double
  // click fires a second invoke — and because the first one flips the confirm
  // state, the second can arrive with force already set, restarting before the
  // user has read the warning they were just shown.
  const [installing, setInstalling] = useState(false);

  const runInstall = async (force: boolean) => {
    if (installing) {
      return;
    }
    setInstalling(true);
    setInstallError(null);
    try {
      await installUpdateAndRestart(force);
    } catch (error: unknown) {
      const live = parseLiveSessionRefusal(error);
      if (live !== null) {
        setLiveSessionCount(live);
        return;
      }
      // #148: this used to be `void installUpdateAndRestart()` — a failed
      // install rejected into nothing and the banner just sat there.
      setInstallError(error instanceof Error ? error.message : String(error));
    } finally {
      // On the success path this never runs — the process has already been
      // replaced by app.restart(). It matters on every failure path.
      setInstalling(false);
    }
  };

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
        {liveSessionCount !== null
          ? `Restarting will close ${liveSessionCount} live SSH session${
              liveSessionCount === 1 ? "" : "s"
            }. Install anyway?`
          : installError
            ? `Update ${updateResult?.version} could not be installed: ${installError}`
            : `Update ${updateResult?.version} available — install and restart to get the latest.`}
      </p>
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          disabled={installing}
          onClick={() => void runInstall(liveSessionCount !== null)}
          className="rounded-control bg-emerald-400 px-3 py-1 text-callout font-medium text-slate-950 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {installing
            ? "Installing…"
            : liveSessionCount !== null
              ? "Close sessions and install"
              : "Install and restart"}
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
