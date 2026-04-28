import { expect, test  } from "./helpers";

// Coverage for /settings — every visible panel and the primary toggle for
// each. Workspace preferences, terminal theme, runtime mode, identities
// manager, local config bundle, and remote sync trust policy.

test.describe("settings page", () => {
  test("page heading + every panel header renders", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "Settings" }).first()).toBeVisible();
    await expect(page.getByText("Workspace preferences", { exact: true })).toBeVisible();
    await expect(page.getByText("Terminal theme", { exact: true })).toBeVisible();
    await expect(page.getByText("Reusable identities", { exact: true })).toBeVisible();
    await expect(page.getByText("Local config bundle", { exact: true })).toBeVisible();
    await expect(page.getByText("Remote sync trust policy", { exact: true })).toBeVisible();
  });

  test("Workspace density toggle exposes Compact + Comfortable", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByRole("button", { name: "Compact" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Comfortable" })).toBeVisible();
    // Click Comfortable then back to Compact — both should work as toggles.
    await page.getByRole("button", { name: "Comfortable" }).click();
    await page.getByRole("button", { name: "Compact" }).click();
  });

  test("Section shortcuts toggle flips its label", async ({ page }) => {
    await page.goto("/settings");
    const toggle = page.getByRole("button", { name: /Section shortcuts/i });
    await expect(toggle).toBeVisible();
    const startLabel = await toggle.textContent();
    await toggle.click();
    const nextLabel = await toggle.textContent();
    expect(nextLabel).not.toBe(startLabel);
  });

  test("Runtime mode toggle is present", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByRole("button", { name: "Demo backend" })).toBeVisible();
  });

  test("Terminal theme picker exposes the auto + named themes", async ({ page }) => {
    await page.goto("/settings");
    const group = page.getByRole("radiogroup", { name: "Terminal theme" });
    await expect(group).toBeVisible();
    // The "Auto (match system)" option's description contains "Slate
    // Emerald" and "High Contrast Light" verbatim — getByText would have
    // multiple matches inside the radiogroup. Querying the role+label
    // combination targets the actual button uniquely.
    await expect(group.getByRole("radio")).toHaveCount(7);
    await expect(group.getByText("Auto (match system)", { exact: true })).toBeVisible();
    await expect(group.getByText("Solarized Dark", { exact: true })).toBeVisible();
    await expect(group.getByText("Solarized Light", { exact: true })).toBeVisible();
    await expect(group.getByText("Monokai", { exact: true })).toBeVisible();
    await expect(group.getByText("Nord", { exact: true })).toBeVisible();
    await expect(group.getByText("High Contrast Light", { exact: true })).toBeVisible();
  });

  test("Selecting Monokai marks its radio aria-checked=true", async ({ page }) => {
    await page.goto("/settings");
    const group = page.getByRole("radiogroup", { name: "Terminal theme" });
    const monokaiRow = group
      .getByText("Monokai", { exact: true })
      .locator("xpath=ancestor::button[1]");
    await monokaiRow.click();
    await expect(monokaiRow).toHaveAttribute("aria-checked", "true");
  });

  test("Identities panel: Add identity opens the inline editor", async ({ page }) => {
    await page.goto("/settings");
    await page.getByRole("button", { name: "Add identity" }).click();
    await expect(page.getByText(/New identity/i)).toBeVisible();
    // Form requires Label + Username + key path before Create is enabled.
    const createBtn = page.getByRole("button", { name: "Create identity" });
    await expect(createBtn).toBeDisabled();
    // Cancel out without persisting.
    await page.getByRole("button", { name: "Cancel" }).click();
  });

  test("Identities panel: list renders the seeded entries", async ({ page }) => {
    await page.goto("/settings");
    // Seeded sample identities include "Deploy Shared Key (deploy)" and the
    // "MacBook Pro ED25519 (ops)" labels.
    await expect(page.getByText(/MacBook Pro ED25519/).first()).toBeVisible();
  });

  test("Local config bundle: Export + Import buttons present", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByRole("button", { name: "Export config" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Import config" })).toBeVisible();
  });

  test("Remote sync trust policy: Export + Import + toggle visible", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByRole("button", { name: "Export trust policy" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Import trust policy" })).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Allow unknown keys|Require trusted keys/ })
    ).toBeVisible();
  });

  test("Trusted key editor accepts an input pair", async ({ page }) => {
    await page.goto("/settings");
    const keyIdInput = page.getByPlaceholder("wrap-key-1");
    await keyIdInput.fill("test-key-id");
    await expect(keyIdInput).toHaveValue("test-key-id");
    // Reset form so we don't bleed.
    await page.getByRole("button", { name: "Reset form" }).click();
    await expect(keyIdInput).toHaveValue("");
  });
});
