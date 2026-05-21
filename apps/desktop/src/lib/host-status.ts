// Derive a per-host connection status from the sessions store. T07.
//
// Status taxonomy (intentionally smaller than SessionConnectionState
// because the dot UI only needs three buckets):
//   - connected   → green dot. At least one pane for this host is in
//                   state "connected".
//   - connecting  → amber dot. At least one pane is "connecting" or
//                   "pendingSecrets" (i.e. waiting on the user to
//                   answer a credential prompt) AND none are connected.
//   - idle        → slate dot. No session pane references this host.
//
// "disconnected" and "error" panes are treated as idle for the dot —
// the user already knows about the error via the terminal pane itself;
// the inventory dot doesn't need to re-shout it.

import type { SessionConnectionState, SessionPane } from "../types/session";

export type HostConnectionStatus = "connected" | "connecting" | "idle";

export function deriveHostConnectionStatus(
  hostId: string,
  panes: Record<string, SessionPane>
): HostConnectionStatus {
  let anyConnected = false;
  let anyConnecting = false;

  for (const pane of Object.values(panes)) {
    if (pane.hostId !== hostId) {
      continue;
    }
    const state: SessionConnectionState = pane.connectionState;
    if (state === "connected") {
      anyConnected = true;
      break; // connected wins — short-circuit.
    }
    if (state === "connecting" || state === "pendingSecrets") {
      anyConnecting = true;
    }
  }

  if (anyConnected) {
    return "connected";
  }
  if (anyConnecting) {
    return "connecting";
  }
  return "idle";
}

export function statusDotClass(status: HostConnectionStatus): string {
  switch (status) {
    case "connected":
      return "bg-emerald-400";
    case "connecting":
      return "bg-amber-300";
    case "idle":
      return "bg-slate-700";
  }
}

export function statusDotAriaLabel(status: HostConnectionStatus): string {
  switch (status) {
    case "connected":
      return "Connected";
    case "connecting":
      return "Connecting";
    case "idle":
      return "Idle";
  }
}
