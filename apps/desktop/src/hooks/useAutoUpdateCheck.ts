// One-shot auto-check at app launch when the user has opted in. T19
// (audit fix: the checkForUpdates helper shipped in Round 6 was
// never wired).
//
// #97: the result is now written into app-store so UpdateAvailableBanner can
// surface it top-of-page (not just on the Settings page). Today the updater is
// a stub returning available:false, so the banner stays hidden until the real
// tauri-plugin-updater lands (#86).

import { useEffect, useRef } from "react";
import { checkForUpdates } from "../lib/auto-update";
import { useAppStore } from "../store/app-store";

export function useAutoUpdateCheck() {
  const enabled = useAppStore((state) => state.autoUpdateCheckOnLaunch);
  const setUpdateResult = useAppStore((state) => state.setUpdateResult);
  const fired = useRef(false);

  useEffect(() => {
    if (!enabled || fired.current) {
      return;
    }
    fired.current = true;
    void checkForUpdates()
      .then((result) => {
        if (result) {
          setUpdateResult(result);
        }
      })
      // #148: checkForUpdates now throws on a real failure instead of resolving
      // null. This is the launch auto-check, so a dead feed must not interrupt
      // the user — but it must not vanish either, or a broken update endpoint
      // stays invisible exactly the way it did before.
      //
      // The reason is deliberately NOT logged. Updater errors can embed the
      // release endpoint, and a private or tokenised feed would put that in a
      // log sink; this repo already carries open js/clear-text-logging alerts.
      // The Settings "Check for updates" button shows the full reason in-app,
      // on demand, which is the right place for it.
      .catch(() => {
        console.error(
          "[termsnip] launch update check failed — open Settings › Check for updates for the reason.",
        );
      });
  }, [enabled, setUpdateResult]);
}
