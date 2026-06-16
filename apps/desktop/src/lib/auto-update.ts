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

export async function checkForUpdates(): Promise<UpdateCheckResult | null> {
  if (!isTauriRuntime()) {
    return null;
  }
  try {
    return await invokeTauriCommand<UpdateCheckResult>("terminal_workspace_check_for_updates", {
      request: {},
    });
  } catch {
    return null;
  }
}

/**
 * Install the most-recently-checked update and restart. No-op in
 * browser preview. Throws on Tauri side if no update has been
 * downloaded yet (caller should always run checkForUpdates first).
 */
export async function installUpdateAndRestart(): Promise<void> {
  if (!isTauriRuntime()) {
    return;
  }
  await invokeTauriCommand<void>("terminal_workspace_install_update_and_restart", {
    request: {},
  });
}
