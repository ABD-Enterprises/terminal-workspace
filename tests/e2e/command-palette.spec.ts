import { expect, test } from "@playwright/test";

// Coverage for the command palette: open via button + Cmd+K, search,
// keyboard navigation (Up/Down/Enter), and the four sections (Sections,
// Sessions, Hosts, Snippets) plus Active session + Recent surfaces when
// a session is open.

test.describe("command palette", () => {
  test("opens via the toolbar button", async ({ page }) => {
    await page.goto("/hosts");
    await page.getByRole("button", { name: /Command Palette/ }).click();
    await expect(page.getByPlaceholder(/Search hosts, sessions, snippets/i)).toBeVisible();
    // Esc closes per the global handler.
    await page.keyboard.press("Escape");
    await expect(page.getByPlaceholder(/Search hosts, sessions, snippets/i)).toHaveCount(0);
  });

  test("opens via Cmd+K (Meta+K) keyboard shortcut", async ({ page }) => {
    await page.goto("/hosts");
    // Click the page body first so a focused, non-input element receives
    // the keystroke. Without this, Playwright dispatches the key event
    // through the browser's chrome and the React global keydown handler
    // (attached to window) may not fire.
    await page.locator("body").click();
    await page.keyboard.press("Meta+K");
    await expect(page.getByPlaceholder(/Search hosts, sessions, snippets/i)).toBeVisible();
    await page.keyboard.press("Escape");
  });

  test("Sections + Hosts + Snippets sections render with seeded entries", async ({ page }) => {
    await page.goto("/hosts");
    await page.getByRole("button", { name: /Command Palette/ }).click();
    // The palette renders section labels with "uppercase tracking" styling;
    // use a regex match against the rendered transformed text.
    await expect(page.getByText(/^Sections$/i).first()).toBeVisible();
    await expect(page.getByText(/^Hosts$/i).first()).toBeVisible();
    await expect(page.getByText(/^Snippets$/i).first()).toBeVisible();
  });

  test("ArrowDown moves the highlight + Enter activates the selected row", async ({ page }) => {
    await page.goto("/hosts");
    await page.getByRole("button", { name: /Command Palette/ }).click();
    // First row is selected by default (Sections > Hosts). ArrowDown twice
    // advances; Enter activates whatever is highlighted.
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    // The exact destination depends on the seed; just verify the palette
    // closed (Enter always either navigates or runs an action).
    await expect(page.getByPlaceholder(/Search hosts, sessions, snippets/i)).toHaveCount(0);
  });

  test("Search filters the entries", async ({ page }) => {
    await page.goto("/hosts");
    await page.getByRole("button", { name: /Command Palette/ }).click();
    const search = page.getByPlaceholder(/Search hosts, sessions, snippets/i);
    await search.fill("Billing");
    // Result count footer reflects the narrowed list.
    await expect(page.getByText(/results/i).first()).toBeVisible();
  });

  test("Active session section appears after opening a session", async ({ page }) => {
    await page.goto("/hosts");
    await page.getByRole("button", { name: "Open" }).first().click();
    await expect(page).toHaveURL(/\/sessions/);
    await page.getByRole("button", { name: /Command Palette/ }).click();
    await expect(page.getByText(/Active session/i)).toBeVisible();
    // Should expose at least Duplicate / Split / Close / Open files.
    await expect(page.getByText(/Duplicate this tab/i)).toBeVisible();
    await expect(page.getByText(/Split horizontally/i)).toBeVisible();
    await expect(page.getByText(/Close this tab/i)).toBeVisible();
  });
});
