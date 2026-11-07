import { useState } from "react";
import { type SessionConnectionState } from "../../types/session";

/**
 * #510: what to say when a pane's connection state changes. Errors are not
 * here: the pane's error banner is a `role="alert"` and announces itself.
 * Connecting is left out to keep reconnect loops from talking constantly.
 */
export function describePaneStatus(
  state: SessionConnectionState,
  label: string
): string | null {
  switch (state) {
    case "connected":
      return `${label}: connected.`;
    case "disconnected":
      return `${label}: disconnected.`;
    case "pendingSecrets":
      return `${label}: needs a password or passphrase to connect.`;
    default:
      return null;
  }
}

/**
 * #510: the text for a pane's polite live region. Only the active pane
 * speaks, so split panes do not talk over each other, and each change is said
 * once. A change that happens while the pane is inactive is not announced
 * later when it becomes active. Derived during render (React's "adjust state
 * when a prop changes" pattern) rather than in an effect.
 */
export function usePaneStatusAnnouncement(
  state: SessionConnectionState,
  label: string,
  active: boolean
): string {
  const [tracked, setTracked] = useState({ state, active });
  const [announcement, setAnnouncement] = useState("");

  if (tracked.state !== state || tracked.active !== active) {
    setTracked({ state, active });
    if (!active) {
      setAnnouncement("");
    } else if (tracked.state !== state) {
      const text = describePaneStatus(state, label);
      if (text) {
        setAnnouncement(text);
      }
    }
  }

  return announcement;
}
