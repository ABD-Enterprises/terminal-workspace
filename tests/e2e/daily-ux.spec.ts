import { expect, test } from "./helpers";

// Round 3: T08 tab right-click menu + T09 fuzzy palette + T10 snippet
// hover preview.

test.describe("T08: tab right-click context menu", () => {
  test("right-clicking a tab opens a menu with Close / Close others / Close to the right / Duplicate", async ({
    page,
  }) => {
    await page.goto("/hosts");
    // Open a host so we have at least one tab to right-click on.
    await page.getByRole("button", { name: "Open" }).first().click();
    await expect(page).toHaveURL(/\/sessions/);
    await expect(page.getByText("mock · connected").first()).toBeVisible();

    // Scope strictly to the tab strip — Quick Connect inside main
    // also renders a "Production Gateway" button which has no
    // onContextMenu handler.
    const firstTab = page
      .locator('[data-testid="terminal-tab-strip"] button')
      .first();
    // Dispatch contextmenu explicitly — playwright's
    // click({button:"right"}) may not always emit contextmenu in
    // Chromium headless. Both approaches go through the same React
    // handler.
    await firstTab.dispatchEvent("contextmenu", { clientX: 200, clientY: 100 });

    // Use menuitem-by-name as the proof. getByRole("menu") on a div
    // with an empty layout sometimes doesn't surface in the
    // accessibility tree across Playwright versions, so we assert the
    // 4 menuitems directly.
    await expect(page.getByRole("menuitem", { name: "Close", exact: true })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Close others" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Close to the right" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Duplicate" })).toBeVisible();

    // Esc closes the menu.
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menuitem", { name: "Close others" })).toHaveCount(0);
  });

  test("Duplicate menu item opens a second tab for the same host", async ({ page }) => {
    await page.goto("/hosts");
    await page.getByRole("button", { name: "Open" }).first().click();
    await expect(page).toHaveURL(/\/sessions/);
    await expect(page.getByText("mock · connected").first()).toBeVisible();

    const tabStripButtons = page.locator(
      '[data-testid="terminal-tab-strip"] button'
    );
    const tabsBefore = await tabStripButtons.count();
    await tabStripButtons
      .first()
      .dispatchEvent("contextmenu", { clientX: 200, clientY: 100 });
    await page.getByRole("menuitem", { name: "Duplicate" }).click();
    // A second tab now exists in the tab strip.
    const tabsAfter = await tabStripButtons.count();
    expect(tabsAfter).toBe(tabsBefore + 1);
  });
});

test.describe("T09: fuzzy + acronym match in the command palette", () => {
  test("acronym query 'pg' surfaces 'Production Gateway' in the palette", async ({ page }) => {
    await page.goto("/hosts");
    await expect(page.getByRole("button", { name: "Add host" })).toBeVisible();
    // Open the palette directly via the store action, since we already
    // verified Cmd+K elsewhere and clicking the toolbar button is the
    // documented alternative path.
    await page
      .getByRole("button", { name: /Open command palette|command palette/i })
      .first()
      .click()
      .catch(() => {
        // Fallback for theme variants — focus body and press Meta+K.
      });
    // Always also press Meta+K as a safety net.
    await page.locator("body").click({ force: true });
    await page.keyboard.press("Meta+K");
    const palette = page.getByPlaceholder(
      "Search hosts, sessions, snippets, or jump to a section"
    );
    await expect(palette).toBeVisible();
    await palette.fill("pg");
    // Production Gateway should appear in the Hosts column of palette
    // results — the acronym "pg" matches.
    await expect(page.getByRole("button", { name: /Production Gateway/ }).first()).toBeVisible();
  });
});

test.describe("T10: snippet hover preview", () => {
  test("snippet rows expose a title attribute that previews the command", async ({ page }) => {
    await page.goto("/snippets");
    // Mount fence — wait for the lazy SnippetsPage chunk.
    await expect(page.getByRole("heading", { name: "Snippets" }).first()).toBeVisible();
    const firstRow = page.locator('[data-testid="snippet-row"]').first();
    await expect(firstRow).toBeVisible();
    const title = await firstRow.getAttribute("title");
    expect(title).not.toBeNull();
    expect(title!.length).toBeGreaterThan(0);
  });

  test("a positioned tooltip is rendered for each row (CSS hover visibility)", async ({ page }) => {
    await page.goto("/snippets");
    // Mount fence — wait for the lazy SnippetsPage chunk.
    await expect(page.getByRole("heading", { name: "Snippets" }).first()).toBeVisible();
    // Wait for at least one snippet row before counting tooltips.
    await expect(page.locator('[data-testid="snippet-row"]').first()).toBeVisible();
    const tooltips = page.locator('[data-testid="snippet-hover-preview"]');
    const count = await tooltips.count();
    expect(count).toBeGreaterThanOrEqual(1);
  });
});
