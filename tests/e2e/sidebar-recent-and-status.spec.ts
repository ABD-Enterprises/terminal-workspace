import { expect, test } from "./helpers";

// Round 2: T06 Recent connections panel + T07 host status dot.
// The seeded fixture includes a "Production Gateway" host with a
// `lastConnectedAt` set, which makes it eligible for the Recent panel
// on first render without needing the user to click anything.

test.describe("T06: Recent connections sidebar panel", () => {
  test("renders when at least one seeded host has a lastConnectedAt", async ({ page }) => {
    await page.goto("/hosts");
    // Wait for the HostsPage lazy chunk to mount before querying for
    // the rows it owns.
    await expect(page.getByRole("button", { name: "Add host" })).toBeVisible();
    const recentRegion = page.getByRole("region", { name: "Recent connections" });
    await expect(recentRegion).toBeVisible();
  });

  test("clicking a Recent row opens (or focuses) the session for that host", async ({ page }) => {
    await page.goto("/hosts");
    // Wait for the HostsPage lazy chunk to mount before querying for
    // the rows it owns.
    await expect(page.getByRole("button", { name: "Add host" })).toBeVisible();
    const recentRegion = page.getByRole("region", { name: "Recent connections" });
    await expect(recentRegion).toBeVisible();
    // Click the first recent row. Seeded fixture has Production Gateway
    // as the most-recent (lastConnectedAt = 2026-04-12).
    const firstRecent = recentRegion.getByRole("button").first();
    await firstRecent.click();
    await expect(page).toHaveURL(/\/sessions/);
  });
});

test.describe("T07: per-host connection status dot", () => {
  test("HostList rows render a status dot per host", async ({ page }) => {
    await page.goto("/hosts");
    // Wait for the HostsPage lazy chunk to mount before querying for
    // the rows it owns.
    await expect(page.getByRole("button", { name: "Add host" })).toBeVisible();
    // The seeded inventory has 4 hosts; each row renders a status dot.
    // We use data-testid because Playwright's accessibility tree
    // treats decorative-sized spans inconsistently across browsers.
    const dots = page.locator('[data-testid="host-status-dot"]');
    const count = await dots.count();
    expect(count).toBeGreaterThanOrEqual(4);
    // Default state is idle for everything (no sessions open yet).
    const idleCount = await page
      .locator('[data-testid="host-status-dot"][data-status="idle"]')
      .count();
    expect(idleCount).toBe(count);
  });

  // Note: the dot's transitions through connecting → connected are
  // covered by unit tests in apps/desktop/src/lib/host-status.test.ts.
  // We deliberately do not assert visual transition in e2e because the
  // TerminalPane resets its pane state on unmount (so navigating away
  // from /sessions back to /hosts puts the dot back to idle). The
  // contract that matters here — "the dot exists for every row and
  // reflects the current store state" — is already verified above.
});
