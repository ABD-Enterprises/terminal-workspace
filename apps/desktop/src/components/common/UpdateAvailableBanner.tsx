// #97: top-of-page "update available" banner. Driven entirely by app-store
// state (Option 2): useAutoUpdateCheck writes the check result into the store
// and this renders when an available, versioned update hasn't been dismissed.
// Today the updater is a stub (returns available:false), so the banner stays
// hidden for real users until the real tauri-plugin-updater lands (#86) — no
// dead UI is shown. The store-driven design makes it fully testable without a
// working updater.

import { useEffect, useReducer, useState } from "react";
import {
  installUpdateAndRestart,
  parseLiveSessionRefusal,
} from "../../lib/auto-update";
import { shouldShowUpdateBanner, useAppStore } from "../../store/app-store";

const UPDATE_INSTALL_PROGRESS_EVENT_NAME = "terminal_workspace://update-install-progress";

export type UpdateInstallProgressEvent =
  | { phase: "downloading"; downloaded: number; total: number | null }
  | { phase: "installing" };

export type UpdateInstallProgressState =
  | { phase: "idle" }
  | { phase: "downloading"; downloaded: number; total: number | null }
  | { phase: "installing" }
  | { phase: "failed"; reason: string };

export type UpdateInstallProgressAction =
  | { type: "started" }
  | { type: "progress"; progress: UpdateInstallProgressEvent }
  | { type: "failed"; reason: string }
  | { type: "reset" };

export const INITIAL_UPDATE_INSTALL_PROGRESS: UpdateInstallProgressState = { phase: "idle" };

export function reduceUpdateInstallProgress(
  state: UpdateInstallProgressState,
  action: UpdateInstallProgressAction,
): UpdateInstallProgressState {
  switch (action.type) {
    case "started":
      return { phase: "downloading", downloaded: 0, total: null };
    case "progress": {
      if (state.phase !== "idle" && state.phase !== "downloading") {
        return state;
      }
      if (action.progress.phase === "installing") {
        return state.phase === "downloading" ? action.progress : state;
      }
      if (state.phase === "idle") {
        return action.progress;
      }
      return {
        ...action.progress,
        downloaded: Math.max(state.downloaded, action.progress.downloaded),
      };
    }
    case "failed":
      return { phase: "failed", reason: action.reason };
    case "reset":
      return INITIAL_UPDATE_INSTALL_PROGRESS;
  }
}

export function deriveDownloadPercentage(state: UpdateInstallProgressState): number | null {
  if (state.phase !== "downloading" || state.total === null || state.total === 0) {
    return null;
  }
  return Math.min(100, Math.max(0, Math.round((state.downloaded / state.total) * 100)));
}

export function deriveUpdateInstallMessage(
  state: UpdateInstallProgressState,
  version?: string,
): string | null {
  const percentage = deriveDownloadPercentage(state);
  switch (state.phase) {
    case "downloading":
      return percentage === null ? "Downloading update…" : `Downloading update… ${percentage}%`;
    case "installing":
      return "Installing update…";
    case "failed":
      return `${version ? `Update ${version}` : "Update"} could not be installed: ${state.reason}`;
    case "idle":
      return null;
  }
}

export function UpdateAvailableBanner() {
  const updateResult = useAppStore((state) => state.updateResult);
  const dismissedUpdateVersion = useAppStore((state) => state.dismissedUpdateVersion);
  const dismissUpdate = useAppStore((state) => state.dismissUpdate);
  // #148: null until the install is refused because sessions are live; then it
  // holds the count so the user is told what they are about to lose.
  const [liveSessionCount, setLiveSessionCount] = useState<number | null>(null);
  // #148: install is async and ends in a process restart. Without this, a double
  // click fires a second invoke — and because the first one flips the confirm
  // state, the second can arrive with force already set, restarting before the
  // user has read the warning they were just shown.
  const [installing, setInstalling] = useState(false);
  // #239: progress is event-driven because the install command cannot return
  // until Tauri has finished downloading and installing (or failed).
  const [installProgress, dispatchInstallProgress] = useReducer(
    reduceUpdateInstallProgress,
    INITIAL_UPDATE_INSTALL_PROGRESS,
  );

  useEffect(() => {
    let cancelled = false;
    let unlistenFn: (() => void) | undefined;

    void import("@tauri-apps/api/event")
      .then(({ listen }) =>
        listen<UpdateInstallProgressEvent>(UPDATE_INSTALL_PROGRESS_EVENT_NAME, (event) => {
          dispatchInstallProgress({ type: "progress", progress: event.payload });
        }),
      )
      .then((unlisten) => {
        if (cancelled) {
          unlisten();
          return;
        }
        unlistenFn = unlisten;
      })
      .catch(() => {
        // Tauri event API is unavailable in browser preview.
      });

    return () => {
      cancelled = true;
      unlistenFn?.();
    };
  }, []);

  const runInstall = async (force: boolean) => {
    if (installing) {
      return;
    }
    setInstalling(true);
    setLiveSessionCount(null);
    dispatchInstallProgress({ type: "started" });
    try {
      await installUpdateAndRestart(force);
    } catch (error: unknown) {
      const live = parseLiveSessionRefusal(error);
      if (live !== null) {
        setLiveSessionCount(live);
        dispatchInstallProgress({ type: "reset" });
        return;
      }
      // #148: this used to be `void installUpdateAndRestart()` — a failed
      // install rejected into nothing and the banner just sat there.
      dispatchInstallProgress({
        type: "failed",
        reason: error instanceof Error ? error.message : String(error),
      });
    } finally {
      // On the success path this never runs — the process has already been
      // replaced by app.restart(). It matters on every failure path.
      setInstalling(false);
    }
  };

  if (!shouldShowUpdateBanner(updateResult, dismissedUpdateVersion)) {
    return null;
  }

  const percentage = deriveDownloadPercentage(installProgress);
  const installMessage = deriveUpdateInstallMessage(installProgress, updateResult?.version);

  return (
    <div
      role="status"
      aria-label="Update available"
      className="flex flex-wrap items-center justify-between gap-3 border-b border-emerald-400/40 bg-emerald-400/10 px-4 py-2"
    >
      <div className="min-w-0 flex-1">
        <p className="text-callout font-medium text-emerald-100">
          {liveSessionCount !== null
            ? `Restarting will close ${liveSessionCount} live SSH session${
                liveSessionCount === 1 ? "" : "s"
              }. Install anyway?`
            : (installMessage ??
              `Update ${updateResult?.version} available — install and restart to get the latest.`)}
        </p>
        {installProgress.phase === "downloading" ? (
          <div
            role="progressbar"
            aria-label="Update download progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percentage ?? undefined}
            className="mt-1.5 h-1.5 w-full max-w-64 overflow-hidden rounded-full bg-slate-800"
          >
            <div
              className={
                percentage === null
                  ? "h-full w-1/3 animate-pulse rounded-full bg-emerald-300"
                  : "h-full rounded-full bg-emerald-300 transition-[width]"
              }
              style={percentage === null ? undefined : { width: `${percentage}%` }}
            />
          </div>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          disabled={installing}
          onClick={() => void runInstall(liveSessionCount !== null)}
          className="rounded-control bg-emerald-400 px-3 py-1 text-callout font-medium text-slate-950 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {installing
            ? installProgress.phase === "installing"
              ? "Installing…"
              : percentage === null
                ? "Downloading…"
                : `Downloading ${percentage}%…`
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
