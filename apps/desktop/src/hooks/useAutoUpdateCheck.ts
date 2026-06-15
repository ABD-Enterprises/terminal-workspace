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
    void checkForUpdates().then((result) => {
      if (result) {
        setUpdateResult(result);
      }
    });
  }, [enabled, setUpdateResult]);
}
