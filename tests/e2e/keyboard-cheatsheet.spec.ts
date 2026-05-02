import { expect, test } from "./helpers";

// Keyboard-first follow-through coverage from the QWEN review:
//   - `?` opens a global cheatsheet listing every keybinding.
//   - `?` while typing in an input is ignored (the user is typing a
//     literal "?" into a field).
//   - Esc and `?` again both close the cheatsheet.
//   - The cheatsheet lists the discoverable surface (Cmd+K, Cmd+1..6,
//     j/k, Enter, Esc) so a new user can learn it without reading docs.

test.describe("keyboard cheatsheet (`?`)", () => {
  test("? opens the cheatsheet from anywhere on /hosts", async ({ page }) => {
    await page.goto("/hosts");
    // Click the body to take focus off any input that might have been
    // auto-focused on load.
    await page.locator("body").click();
    await page.keyboard.press("?");
    await expect(page.getByRole("heading", { name: "Keyboard shortcuts" })).toBeVisible();

    // Spot-check that the documented bindings are present.
    await expect(page.getByText("Open the command palette")).toBeVisible();
    await expect(page.getByText("Move selection down")).toBeVisible();
    await expect(page.getByText("Confirm the primary action").first()).toBeVisible();
  });

  test("? while typing in the sidebar search is ignored", async ({ page }) => {
    await page.goto("/hosts");
    const search = page.getByPlaceholder("Search the host inventory");
    await search.click();
    await search.fill("");
    await page.keyboard.press("?");
    // The cheatsheet must NOT have opened — the `?` was a literal char.
    await expect(page.getByRole("heading", { name: "Keyboard shortcuts" })).toHaveCount(0);
    // And the search input received the literal "?".
    await expect(search).toHaveValue("?");
    await search.fill("");
  });

  test("Esc closes the cheatsheet", async ({ page }) => {
    await page.goto("/hosts");
    await page.locator("body").click();
    await page.keyboard.press("?");
    await expect(page.getByRole("heading", { name: "Keyboard shortcuts" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("heading", { name: "Keyboard shortcuts" })).toHaveCount(0);
  });

  test("? toggles the cheatsheet (open then close)", async ({ page }) => {
    await page.goto("/hosts");
    await page.locator("body").click();
    await page.keyboard.press("?");
    await expect(page.getByRole("heading", { name: "Keyboard shortcuts" })).toBeVisible();
    await page.keyboard.press("?");
    await expect(page.getByRole("heading", { name: "Keyboard shortcuts" })).toHaveCount(0);
  });
});
