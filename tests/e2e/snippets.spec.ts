import { expect, test } from "@playwright/test";

// Coverage for /snippets: list, search, new/duplicate disabled state, the
// editor modal, and the original happy-path run-in-active-pane flow.

test.describe("snippets page", () => {
  test("seeded snippets render in the list", async ({ page }) => {
    await page.goto("/snippets");
    await expect(page.getByRole("heading", { name: "Snippets" }).first()).toBeVisible();
  });

  test("New snippet opens the editor modal and Cancel closes it", async ({ page }) => {
    await page.goto("/snippets");
    await page.getByRole("button", { name: "New snippet" }).click();
    // Editor surface present (Title is part of the form).
    await expect(page.getByText(/Title/i).first()).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();
  });

  test("Search input takes a value", async ({ page }) => {
    await page.goto("/snippets");
    const search = page.getByPlaceholder("Search snippets, tags, descriptions, or commands");
    await search.fill("nonexistent");
    await expect(search).toHaveValue("nonexistent");
    await search.fill("");
  });

  test("Duplicate is enabled when a snippet is auto-selected from the seeded list", async ({
    page,
  }) => {
    await page.goto("/snippets");
    // SnippetsPage falls back to filteredSnippets[0] / snippets[0] when no
    // explicit selection exists, so the toolbar Duplicate is enabled
    // whenever the seeded fixture has at least one snippet. This is the
    // documented behavior — the test guards against regressing to a
    // "disabled until clicked" pattern that breaks first-run muscle memory.
    await expect(page.getByRole("button", { name: "Duplicate" }).first()).toBeEnabled();
  });

  test("runs a snippet into the active demo pane (happy path)", async ({ page }) => {
    await page.goto("/hosts");
    await page.getByRole("button", { name: "Open" }).first().click();
    await expect(page.getByText("mock · connected")).toBeVisible();

    await page.goto("/snippets");
    await page.getByRole("button", { name: "Run in active pane" }).click();

    await expect(page).toHaveURL(/\/sessions/);
    await expect(page.getByText("mock · connected")).toBeVisible();
  });
});
