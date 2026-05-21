import { expect, test } from "./helpers";

// Round 6: T17 notifications + T18 dock badge + T19 auto-update + T20
// app-shell theme. All four ship as Settings toggles that persist
// across reload. The actual native integrations (notification API,
// dock badge, updater) are no-ops in browser preview; the UI surface
// is what we cover here.

test.describe("T20: app-shell theme toggle", () => {
  test("the theme picker exposes system / light / dark options", async ({ page }) => {
    await page.goto("/settings");
    const group = page.getByRole("radiogroup", { name: "App shell theme" });
    await expect(group).toBeVisible();
    for (const option of ["system", "light", "dark"] as const) {
      await expect(group.getByRole("radio", { name: `App shell theme ${option}` })).toBeVisible();
    }
  });

  test("selecting Light updates the data-app-theme attribute on <html>", async ({ page }) => {
    await page.goto("/settings");
    await page.getByRole("radio", { name: "App shell theme light" }).click();
    const theme = await page.evaluate(() => document.documentElement.dataset.appTheme);
    expect(theme).toBe("light");
  });

  test("selecting Dark updates the data-app-theme attribute on <html>", async ({ page }) => {
    await page.goto("/settings");
    await page.getByRole("radio", { name: "App shell theme dark" }).click();
    const theme = await page.evaluate(() => document.documentElement.dataset.appTheme);
    expect(theme).toBe("dark");
  });

  test("the theme choice persists across reload", async ({ page }) => {
    await page.goto("/settings");
    await page.getByRole("radio", { name: "App shell theme light" }).click();
    await page.reload();
    const theme = await page.evaluate(() => document.documentElement.dataset.appTheme);
    expect(theme).toBe("light");
    // The radio in Settings reflects the persisted choice.
    await expect(
      page.getByRole("radio", { name: "App shell theme light" })
    ).toHaveAttribute("aria-checked", "true");
  });
});

test.describe("T17/T18/T19: OS-integration toggles", () => {
  test("Settings exposes Native notifications + Dock badge + Update check toggles", async ({
    page,
  }) => {
    await page.goto("/settings");
    await expect(page.getByLabel("Enable native notifications")).toBeVisible();
    await expect(page.getByLabel("Enable dock badge")).toBeVisible();
    await expect(page.getByLabel("Check for updates on launch")).toBeVisible();
  });

  test("Toggling each one persists across reload", async ({ page }) => {
    await page.goto("/settings");
    // All three default false in browser preview.
    const notif = page.getByLabel("Enable native notifications");
    const dock = page.getByLabel("Enable dock badge");
    const update = page.getByLabel("Check for updates on launch");
    await expect(notif).not.toBeChecked();
    await expect(dock).not.toBeChecked();
    await expect(update).not.toBeChecked();

    await notif.check();
    await dock.check();
    await update.check();

    await page.reload();

    await expect(page.getByLabel("Enable native notifications")).toBeChecked();
    await expect(page.getByLabel("Enable dock badge")).toBeChecked();
    await expect(page.getByLabel("Check for updates on launch")).toBeChecked();
  });
});
