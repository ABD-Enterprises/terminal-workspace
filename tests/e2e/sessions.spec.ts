import { expect, test } from "@playwright/test";

test("opens a mock session from the hosts inventory", async ({ page }) => {
  await page.goto("/hosts");
  await page.getByRole("button", { name: "Open" }).first().click();

  await expect(page).toHaveURL(/\/sessions/);
  await expect(page.getByText("mock · connected")).toBeVisible();
  await expect(page.getByText("Session workspace")).toBeVisible();
});
