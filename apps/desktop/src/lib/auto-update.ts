// In-app update check + install. T19.
//
// Tauri ship: routes through `terminal_workspace_check_for_updates`, which wraps
// tauri-plugin-updater against the GitHub Releases `latest.json` endpoint
// (#86). Browser preview: returns null (no updates to check for in dev).
//
// Caller pattern:
//   const update = await checkForUpdates();
//   if (update?.available) { /* show "Install + restart" banner */ }

import { invokeTauriCommand, isTauriRuntime } from "./backend-runtime";

export interface UpdateCheckResult {
  available: boolean;
  /** The new version string, e.g. "0.2.0". Present when available. */
  version?: string;
  /** Optional release notes (Markdown). */
  notes?: string;
}

/**
 * #148: this used to wrap the invoke in `try { … } catch { return null }`.
 *
 * The Rust side deliberately returns `Err` with a reason so the caller can show
 * it — and `null` already means something else here: "not running under Tauri".
 * Collapsing both into `null` defeated that contract at the boundary and made a
 * genuinely broken update feed indistinguishable from browser preview. The
 * Settings page's existing catch reported a real 404 from GitHub Releases as
 * "Not available in browser preview", which is worse than saying nothing.
 *
 * So: `null` means browser preview, and a real failure throws with the reason.
 */
export async function checkForUpdates(): Promise<UpdateCheckResult | null> {
  if (!isTauriRuntime()) {
    return null;
  }
  return await invokeTauriCommand<UpdateCheckResult>("terminal_workspace_check_for_updates", {
    request: {},
  });
}

/**
 * Thrown when the install was refused because SSH sessions are still live.
 * #148: restarting used to kill them with no warning; the Rust side now
 * refuses unless the caller explicitly confirms.
 */
export const LIVE_SESSIONS_MARKER = "live-sessions:";

export function parseLiveSessionRefusal(error: unknown): number | null {
  const message = error instanceof Error ? error.message : String(error);
  const index = message.indexOf(LIVE_SESSIONS_MARKER);
  if (index === -1) {
    return null;
  }
  const count = Number.parseInt(message.slice(index + LIVE_SESSIONS_MARKER.length), 10);
  return Number.isFinite(count) && count > 0 ? count : null;
}

/**
 * Install the most-recently-checked update and restart. No-op in
 * browser preview. Throws on Tauri side if no update has been
 * downloaded yet (caller should always run checkForUpdates first).
 *
 * #148: restart tears down every live SSH session. Called without `force` the
 * Rust side refuses while sessions are open and reports how many; the caller is
 * expected to confirm with the user and retry with `force: true`.
 */
export async function installUpdateAndRestart(force = false): Promise<void> {
  if (!isTauriRuntime()) {
    return;
  }
  await invokeTauriCommand<void>("terminal_workspace_install_update_and_restart", {
    request: { force },
  });
}
