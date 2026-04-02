import { expect, test } from "@playwright/test";

test("runs a snippet into the active demo pane", async ({ page }) => {
  await page.goto("/hosts");
  await page.getByRole("button", { name: "Open" }).first().click();
  await expect(page.getByText("mock · connected")).toBeVisible();

  await page.goto("/snippets");
  await page.getByRole("button", { name: "Run in active pane" }).click();

  await expect(page).toHaveURL(/\/sessions/);
  await expect(page.getByText("mock · connected")).toBeVisible();
});
