// Subscribe to session-tab count + the user's opt-in toggle and
// update the macOS dock badge in real time. T18 (audit fix: the
// setDockBadge helper shipped in Round 6 was never wired).

import { useEffect } from "react";
import { setDockBadge } from "../lib/dock-badge";
import { useAppStore } from "../store/app-store";
import { useSessionsStore } from "../store/sessions-store";

export function useDockBadgeSync() {
  const dockBadgeEnabled = useAppStore((state) => state.dockBadgeEnabled);
  const tabCount = useSessionsStore((state) => state.tabs.length);

  useEffect(() => {
    if (!dockBadgeEnabled) {
      // User toggled the badge off — clear it.
      void setDockBadge(0);
      return;
    }
    void setDockBadge(tabCount);
  }, [dockBadgeEnabled, tabCount]);
}
