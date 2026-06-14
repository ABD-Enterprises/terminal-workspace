import { expect, test } from "./helpers";

// Cold-start onboarding bundle: T01 sidebar Local terminal +
// T02 WelcomePanel + T03 ImportSshCallout + T04 demo-mode toggle +
// T05 FirstRunTour.
//
// Many of these only render when the user is in a "fresh" state. The
// e2e fixture seeds hosts (demoModeEnabled defaults true in browser
// mode), so we clear localStorage and reload before exercising the
// cold-start surfaces.

async function clearStateAndReload(page: import("@playwright/test").Page) {
  // Visit the app first so localStorage is bound to the right origin.
  await page.goto("/hosts");
  await page.evaluate(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });
  // Hard reload picks up the cleared state. With demoModeEnabled
  // defaulted true in browser mode, sample hosts will re-seed —
  // we explicitly turn the seed off via the persist payload.
  await page.evaluate(() => {
    // Persist a minimal app-store payload with demoModeEnabled = false
    // so the next hydrate doesn't bring sample hosts back.
    window.localStorage.setItem(
      "termsnip-app",
      JSON.stringify({
        state: {
          workspaceDensity: "compact",
          sectionShortcutsEnabled: true,
          demoModeEnabled: false,
          terminalTheme: "slate-emerald",
          vaultId: "00000000-0000-4000-8000-000000000000",
          deviceId: "00000000-0000-4000-8000-000000000001",
          lastAppliedSnapshotId: null,
          sawImportCallout: false,
          sawFirstRunTour: false,
        },
        version: 5,
      })
    );
    // Empty hosts payload (version 2 schema).
    window.localStorage.setItem(
      "termsnip-hosts",
      JSON.stringify({ state: { hosts: [] }, version: 2 })
    );
  });
  await page.reload();
}

test.describe("T01: sidebar Local terminal quick-launch", () => {
  test("clicking Local terminal opens a session", async ({ page }) => {
    await page.goto("/hosts");
    const localBtn = page.getByRole("button", { name: "Open local terminal" });
    await expect(localBtn).toBeVisible();
    await localBtn.click();
    await expect(page).toHaveURL(/\/sessions/);
  });

  test("clicking Local terminal twice reuses the existing tab", async ({ page }) => {
    await page.goto("/hosts");
    const localBtn = page.getByRole("button", { name: "Open local terminal" });
    await localBtn.click();
    await expect(page).toHaveURL(/\/sessions\?tabId=/);
    const firstUrl = page.url();
    // Click again from the sidebar — should focus the same tab, not
    // open a new one. URL stays on the same tabId.
    await localBtn.click();
    await expect(page).toHaveURL(/\/sessions\?tabId=/);
    expect(page.url()).toBe(firstUrl);
  });
});

test.describe("T02: cold-start WelcomePanel", () => {
  test("renders the welcome region when inventory is empty", async ({ page }) => {
    await clearStateAndReload(page);
    await expect(page.getByRole("region", { name: "Welcome to Terminal Workspace" })).toBeVisible();
    // All four CTAs are present.
    await expect(page.getByRole("button", { name: /Import ~\/.ssh\/config/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Add a host manually/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Open a local terminal/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Load sample data/ })).toBeVisible();
  });

  test("Add host CTA opens the editor", async ({ page }) => {
    await clearStateAndReload(page);
    await page.getByRole("button", { name: /Add a host manually/ }).click();
    await expect(page.getByRole("heading", { name: "Add Host" })).toBeVisible();
    // Cancel out so we don't pollute next test's state.
    await page.getByRole("button", { name: "Cancel" }).click();
  });
});

test.describe("T04: Load sample data flips demoModeEnabled and seeds hosts", () => {
  test("clicking 'Load sample data' brings in seeded inventory", async ({ page }) => {
    await clearStateAndReload(page);
    await page.getByRole("button", { name: /Load sample data/ }).click();
    // After the flip, the seeded sample fixture re-renders: at least one
    // of the known seed labels should appear in the inventory.
    await expect(page.getByText("Production Gateway").first()).toBeVisible();
    // The welcome region should be gone (allHosts.length > 0 now).
    await expect(page.getByRole("region", { name: "Welcome to Terminal Workspace" })).toHaveCount(0);
  });
});

test.describe("T03: ImportSshCallout banner", () => {
  test("renders once when inventory has hosts and the user hasn't dismissed it", async ({
    page,
  }) => {
    // Default state has seeded hosts (demoModeEnabled = true) and the
    // app-store starts with sawImportCallout = false — so the callout
    // should appear on first /hosts visit.
    await page.goto("/hosts");
    const callout = page.getByRole("status", { name: "Import SSH config callout" });
    await expect(callout).toBeVisible();
  });

  test("dismissing the callout persists across reload", async ({ page }) => {
    await page.goto("/hosts");
    const callout = page.getByRole("status", { name: "Import SSH config callout" });
    await expect(callout).toBeVisible();
    await page.getByRole("button", { name: "Dismiss import callout" }).click();
    await expect(callout).toHaveCount(0);
    // Reload — the dismissal is persisted.
    await page.reload();
    await expect(page.getByRole("status", { name: "Import SSH config callout" })).toHaveCount(0);
  });
});

test.describe("T05: FirstRunTour", () => {
  test("renders on first run and dismissing it persists across reload", async ({ page }) => {
    await clearStateAndReload(page);
    const tour = page.getByRole("status", { name: "First-run tour" });
    await expect(tour).toBeVisible();
    // Spot-check the documented shortcuts appear.
    await expect(page.getByRole("button", { name: "All keyboard shortcuts" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Jump anywhere" })).toBeVisible();
    // Dismiss it.
    await page.getByRole("button", { name: "Dismiss first-run tour" }).click();
    await expect(tour).toHaveCount(0);
    // Persists across reload.
    await page.reload();
    await expect(page.getByRole("status", { name: "First-run tour" })).toHaveCount(0);
  });

  test("clicking 'All keyboard shortcuts' inside the tour opens the cheatsheet", async ({ page }) => {
    await clearStateAndReload(page);
    await page.getByRole("button", { name: "All keyboard shortcuts" }).click();
    await expect(page.getByRole("heading", { name: "Keyboard shortcuts" })).toBeVisible();
  });
});
