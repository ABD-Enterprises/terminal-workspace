// One-shot auto-check at app launch when the user has opted in. T19
// (audit fix: the checkForUpdates helper shipped in Round 6 was
// never wired).
//
// We don't expose the result here; the Settings page surfaces both
// the manual button and the result banner. This hook exists to fire
// the check once on app mount, after which the user can re-trigger
// it from Settings or wait for the next launch.

import { useEffect, useRef } from "react";
import { checkForUpdates } from "../lib/auto-update";
import { useAppStore } from "../store/app-store";

export function useAutoUpdateCheck() {
  const enabled = useAppStore((state) => state.autoUpdateCheckOnLaunch);
  const fired = useRef(false);

  useEffect(() => {
    if (!enabled || fired.current) {
      return;
    }
    fired.current = true;
    void checkForUpdates();
  }, [enabled]);
}
