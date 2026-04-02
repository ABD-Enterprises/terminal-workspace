import { expect, test } from "@playwright/test";

test("shows seeded host details and trusted known-host state", async ({ page }) => {
  await page.goto("/hosts");

  await expect(page.getByRole("heading", { name: "Production Gateway" })).toBeVisible();
  await expect(page.getByText("MacBook Pro ED25519").first()).toBeVisible();

  await page.getByRole("button", { name: /Billing API/ }).first().click();
  await expect(page.getByRole("heading", { name: "Billing API" })).toBeVisible();
  await expect(page.getByText("Deploy Shared Key").first()).toBeVisible();
  await expect(page.getByText(/trusted/i).first()).toBeVisible();
});
