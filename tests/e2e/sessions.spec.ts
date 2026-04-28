import { expect, test } from "@playwright/test";

// Coverage for /sessions: mock session lifecycle, command-history toolbar,
// and the workspace tab strip. Avoids unnecessary terminal interaction
// (the headless xterm in CI is slow + brittle for keystroke-level tests).

test.describe("sessions page", () => {
  test("opens a mock session from the hosts inventory", async ({ page }) => {
    await page.goto("/hosts");
    await page.getByRole("button", { name: "Open" }).first().click();
    await expect(page).toHaveURL(/\/sessions/);
    await expect(page.getByText("mock · connected")).toBeVisible();
    await expect(page.getByText("Session workspace")).toBeVisible();
  });

  test("Command history toolbar renders the search field and Clear button", async ({ page }) => {
    await page.goto("/sessions");
    const search = page.getByLabel("Search command history");
    await expect(search).toBeVisible();
    const clear = page.getByLabel("Clear saved command history");
    await expect(clear).toBeVisible();
    // With no history yet, Clear is disabled.
    await expect(clear).toBeDisabled();
  });

  test("Search command history takes input without crashing", async ({ page }) => {
    await page.goto("/sessions");
    const search = page.getByLabel("Search command history");
    await search.fill("nothing-matches");
    await expect(search).toHaveValue("nothing-matches");
  });

  test("Empty state copy renders when no command history exists", async ({ page }) => {
    await page.goto("/sessions");
    await expect(
      page.getByText(/No saved commands yet/i)
    ).toBeVisible();
  });

  test("After opening a session, the active-tab badge counts panes", async ({ page }) => {
    await page.goto("/hosts");
    await page.getByRole("button", { name: "Open" }).first().click();
    await expect(page).toHaveURL(/\/sessions/);
    // The header reads "1 tab active • 1 pane in focus".
    await expect(page.getByText(/1 tab active/i)).toBeVisible();
    await expect(page.getByText(/1 pane in focus/i)).toBeVisible();
  });
});
