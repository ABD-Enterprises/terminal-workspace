import { expect, test } from "@playwright/test";
import { capture } from "./helpers";

test("walks the primary routes and captures browser screenshots", async ({ page }) => {
  await page.goto("/hosts");
  await expect(page.getByRole("heading", { name: "Hosts" }).first()).toBeVisible();
  await capture(page, "hosts-route.png");

  await page.getByRole("button", { name: "Open" }).first().click();
  await expect(page).toHaveURL(/\/sessions/);
  await expect(page.getByText("mock · connected")).toBeVisible();
  await capture(page, "sessions-route.png");

  await page.goto("/snippets");
  await expect(page.getByRole("heading", { name: "Snippets" }).first()).toBeVisible();
  await capture(page, "snippets-route.png");

  await page.goto("/keys");
  await expect(page.getByRole("heading", { name: "Keys" }).first()).toBeVisible();
  await expect(page.getByText("MacBook Pro ED25519").first()).toBeVisible();
  await capture(page, "keys-route.png");

  await page.goto("/transfers");
  await expect(page.getByRole("heading", { name: "Transfers" }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: /deploy\.log/ }).first()).toBeVisible();
  await expect(page.getByText("ENOENT")).toHaveCount(0);
  await capture(page, "transfers-route.png");

  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Settings" }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Demo backend" })).toBeVisible();
  await capture(page, "settings-route.png");
});
