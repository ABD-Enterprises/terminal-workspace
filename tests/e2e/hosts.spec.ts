import { expect, test } from "@playwright/test";

test("shows seeded host details and trusted known-host state", async ({ page }) => {
  await page.goto("/hosts");

  await expect(page.getByText("Production Gateway").first()).toBeVisible();
  await expect(page.getByText("MacBook Pro ED25519").first()).toBeVisible();

  await page.getByRole("button", { name: /Billing API/ }).first().click();
  await expect(page.getByText("Billing API").first()).toBeVisible();
  await expect(page.getByText("Deploy Shared Key").first()).toBeVisible();
  await expect(page.getByText(/ssh-ed25519 · trusted/i).first()).toBeVisible();
});
