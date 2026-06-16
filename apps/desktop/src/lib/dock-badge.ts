// macOS dock badge for active session count. T18.
//
// Tauri ship: invokes a `terminal_workspace_set_dock_badge` command that calls
// the platform-specific Window::set_badge_count Tauri 2 API (currently
// behind a feature flag on macOS — follow-up to wire the Rust side).
// Browser preview: no-op.
//
// We expose a single function `setDockBadge(count)` that the AppShell
// subscribes to sessionsStore changes and calls on every render.

import { invokeTauriCommand, isTauriRuntime } from "./backend-runtime";

export async function setDockBadge(count: number): Promise<void> {
  if (!isTauriRuntime()) {
    return;
  }
  try {
    await invokeTauriCommand<void>("terminal_workspace_set_dock_badge", {
      request: { count: Math.max(0, Math.floor(count)) },
    });
  } catch {
    // Tauri command may not be installed yet in the offline ship.
    // Swallow — there's no UI affordance to surface a dock-badge
    // failure, and the panel-only fallback works fine.
  }
}
