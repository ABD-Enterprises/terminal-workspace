// Subscribe to pane state changes and fire a native notification
// when a session transitions from "connected" → "disconnected" or
// "error". T17 (audit fix: the fireNotification helper shipped in
// Round 6 was never wired).
//
// Heuristics to avoid notification spam:
//   - Only fire on a real transition (not on initial mount).
//   - Skip if document.hasFocus() AND the disconnected pane is the
//     active pane (the user is watching it; they can see the state
//     change in the terminal).
//   - Respect the user's notificationsEnabled toggle (the fireNotification
//     helper short-circuits internally too, but checking here saves
//     us from tracking state if the user has it off).
//
// We track previous pane state in a ref-mirror map so the effect can
// detect transitions without re-subscribing each render.

import { useEffect, useRef } from "react";
import { fireNotification } from "../lib/notifications";
import { useAppStore } from "../store/app-store";
import { useSessionsStore } from "../store/sessions-store";
import type { SessionConnectionState } from "../types/session";

export function useDisconnectNotifications() {
  const notificationsEnabled = useAppStore((state) => state.notificationsEnabled);
  const panes = useSessionsStore((state) => state.panes);
  const tabs = useSessionsStore((state) => state.tabs);
  const activeTabId = useSessionsStore((state) => state.activeTabId);
  const previousState = useRef<Map<string, SessionConnectionState>>(new Map());

  useEffect(() => {
    if (!notificationsEnabled) {
      // Reset our shadow map so the next time the user opts in we
      // don't fire on "transitions" that happened while we weren't
      // watching.
      previousState.current.clear();
      return;
    }

    const next = new Map<string, SessionConnectionState>();
    for (const [paneId, pane] of Object.entries(panes)) {
      next.set(paneId, pane.connectionState);
      const prior = previousState.current.get(paneId);
      if (prior === undefined) {
        continue; // first time we've seen this pane
      }
      const justDisconnected =
        (prior === "connected" || prior === "connecting") &&
        (pane.connectionState === "disconnected" || pane.connectionState === "error");
      if (!justDisconnected) {
        continue;
      }
      // Skip if the disconnected pane is the active one AND the
      // window is focused — the user is already looking at it.
      const owningTab = tabs.find((tab) => tab.paneIds.includes(paneId));
      const isActive =
        owningTab !== undefined &&
        owningTab.id === activeTabId &&
        owningTab.activePaneId === paneId;
      if (isActive && typeof document !== "undefined" && document.hasFocus()) {
        continue;
      }
      void fireNotification({
        kind: "session-disconnected",
        title: "Session disconnected",
        body: pane.title || "An SSH session ended.",
      });
    }
    previousState.current = next;
  }, [activeTabId, notificationsEnabled, panes, tabs]);
}
