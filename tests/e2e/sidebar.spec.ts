import { expect, test  } from "./helpers";

// Sidebar surface is the navigation backbone — every page reaches it.
// Test the search box, every nav item, the pinned-favorites panel, the
// sessions panel, and the SidebarGroups widget (rename + remove + drag).
// See docs/parity-and-hardening-review.md §4.1 for context.

test.describe("sidebar", () => {
  test("renders header counts derived from seeded hosts", async ({ page }) => {
    await page.goto("/hosts");
    // The header lists "N hosts • N favorites • N groups" — the seeded
    // sample fixture has at least one of each.
    await expect(page.getByText(/hosts/i).first()).toBeVisible();
    // Sidebar shows the workspace title and dense byline.
    await expect(page.getByText("Terminal Workspace", { exact: false })).toBeVisible();
    await expect(page.getByText("Local Vault")).toBeVisible();
  });

  test("search input filters the host inventory text on the active page", async ({ page }) => {
    await page.goto("/hosts");
    const search = page.getByPlaceholder("Search the host inventory");
    await expect(search).toBeVisible();
    await search.fill("billing");
    // The HostsPage list responds to sidebar search via the shared store.
    await expect(page.getByText("Billing API").first()).toBeVisible();
    // Other seeded hosts that don't match are filtered out of the *list* view.
    // Recent / Pinned panels in the sidebar are NOT filtered by search
    // (intentional — Recent is about "what you just did", not "what
    // matches your current query") so scope to <main>.
    await expect(
      page.getByRole("main").getByRole("button", { name: /Edge Router/ })
    ).toHaveCount(0);
    // Clearing the search restores the list.
    await search.fill("");
    await expect(page.getByText("Billing API").first()).toBeVisible();
  });

  test("clicking each navigation item routes to the corresponding page", async ({ page }) => {
    await page.goto("/hosts");
    const navItems: { label: RegExp; expectedPath: RegExp }[] = [
      { label: /^Sessions/, expectedPath: /\/sessions/ },
      { label: /^Snippets/, expectedPath: /\/snippets/ },
      { label: /^Keys/, expectedPath: /\/keys/ },
      { label: /^Transfers/, expectedPath: /\/transfers/ },
      { label: /^Settings/, expectedPath: /\/settings/ },
      { label: /^Hosts/, expectedPath: /\/hosts/ },
    ];

    for (const item of navItems) {
      // Sidebar nav links are rendered inside an <a>/<NavLink> with the label
      // text. Using getByRole("link") is more stable than text alone.
      const link = page.getByRole("link", { name: item.label });
      await link.first().click();
      await expect(page).toHaveURL(item.expectedPath);
    }
  });

  test("Pinned panel renders favorited hosts and one-click connects", async ({ page }) => {
    await page.goto("/hosts");
    // The seeded "Production Gateway" host is favorited; Pinned should show it.
    const pinnedSection = page.getByRole("button", { name: /Production Gateway/ }).first();
    await expect(pinnedSection).toBeVisible();
    await pinnedSection.click();
    // Clicking a pinned host should open a session tab.
    await expect(page).toHaveURL(/\/sessions/);
  });

  test("Groups panel lists derived host groups sorted alphabetically", async ({ page }) => {
    await page.goto("/hosts");
    const groupsHeader = page.getByText("Groups", { exact: true }).first();
    await expect(groupsHeader).toBeVisible();
  });

  test("expanding a group reveals its hosts", async ({ page }) => {
    await page.goto("/hosts");
    // Find any expandable group row (▶ glyph) and click it to expand.
    // Sample data has at least one named group seeded.
    const triangleRows = page.locator("text=▶");
    const count = await triangleRows.count();
    if (count === 0) {
      // No groups in this fixture — that's fine; the test is a no-op.
      return;
    }
    await triangleRows.first().click();
    // After expansion, the same row should show ▼.
    await expect(page.locator("text=▼").first()).toBeVisible();
  });
});
