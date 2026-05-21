// Native notification surface. T17.
//
// Browser path uses the standard Notification API (permission +
// constructor). Tauri path will route through tauri-plugin-notification
// once the Rust dependency lands in the offline cache; until then the
// Tauri branch falls back to the same Notification API call (Tauri 2's
// webview supports it natively as a no-op on macOS without permissions
// granted via Info.plist — so the worst case is the same browser path
// runs and silently no-ops).

import { useAppStore } from "../store/app-store";

export type NotificationKind = "session-disconnected" | "snippet-finished";

interface NotifyArgs {
  kind: NotificationKind;
  title: string;
  body: string;
}

function notificationsApiAvailable(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

export async function ensureNotificationPermission(): Promise<boolean> {
  if (!notificationsApiAvailable()) {
    return false;
  }
  if (Notification.permission === "granted") {
    return true;
  }
  if (Notification.permission === "denied") {
    return false;
  }
  try {
    const result = await Notification.requestPermission();
    return result === "granted";
  } catch {
    return false;
  }
}

/**
 * Fire a native notification if the user has opted in AND the platform
 * supports it. Caller controls the kind so future fine-grained opt-ins
 * (e.g. "disconnects only, no snippets") can be added without breaking
 * the call sites.
 */
export async function fireNotification(args: NotifyArgs): Promise<boolean> {
  const enabled = useAppStore.getState().notificationsEnabled;
  if (!enabled) {
    return false;
  }
  if (!notificationsApiAvailable()) {
    return false;
  }
  if (Notification.permission !== "granted") {
    const granted = await ensureNotificationPermission();
    if (!granted) {
      return false;
    }
  }
  try {
    // eslint-disable-next-line no-new
    new Notification(args.title, { body: args.body, tag: args.kind });
    return true;
  } catch {
    return false;
  }
}
