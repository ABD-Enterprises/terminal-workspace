import { expect, test } from "./helpers";

// Audit follow-up for Round 6: the three Tauri-flavored helpers
// shipped in T17/T18/T19 were never called from anywhere — the JS
// surfaces existed but no consumer was wired. This spec covers the
// wiring fix.
//
// What we can assert in browser preview:
//   - useDockBadgeSync mounts cleanly when on /hosts (no console
//     error from a non-existent Tauri command call).
//   - useDisconnectNotifications mounts cleanly.
//   - The Check for updates button is visible in Settings and clicking
//     it produces a status message (returns the browser-preview
//     fallback string rather than throwing).
//
// Native Tauri integrations (real dock badge, OS notification,
// updater plugin) are follow-ups that require Rust changes.

test.describe("Audit: Round 6 helpers are wired", () => {
  test("AppShell mounts the new dock-badge / notification / auto-update hooks without errors", async ({
    page,
  }) => {
    // The console-error guard in helpers.ts auto-fails if anything
    // throws on mount. Just navigating + interacting with the
    // sidebar is enough exercise for the three hooks.
    await page.goto("/hosts");
    await expect(page.getByRole("button", { name: "Add host" })).toBeVisible();
    await page.getByRole("link", { name: /^Sessions/ }).click();
    await expect(page).toHaveURL(/\/sessions/);
  });

  test("Settings 'Check for updates' button surfaces a status in browser preview", async ({ page }) => {
    await page.goto("/settings");
    const button = page.getByRole("button", { name: "Check for updates" });
    await expect(button).toBeVisible();
    await button.click();
    // Browser-preview path: checkForUpdates returns null, status
    // copy includes "browser preview".
    // Multiple regions contain "browser preview" copy — use the
    // exact status string the button writes.
    await expect(
      page.getByText(/Not available in browser preview/i)
    ).toBeVisible();
  });
});
