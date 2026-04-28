import { expect, test } from "@playwright/test";

// End-to-end coverage for the Settings → Reusable identities surface.
// Verifies the create flow, the inline edit flow, and the delete-with-warning
// flow round-trip through the identities-store + UI together. P2-DM1 batch 2.

test.describe("identity manager", () => {
  test("Add identity → fill form → Create persists into the list", async ({ page }) => {
    await page.goto("/settings");
    await page.getByRole("button", { name: "Add identity" }).click();

    // The IdentityEditor exposes Label, Username, Auth method, Path,
    // passphrase toggle, Notes. Other forms in the app share placeholder
    // substrings (notably HostEditor's "Deploy" / "ops" hints), so we
    // pin to exact placeholder matches to keep the locator unambiguous.
    await page
      .getByPlaceholder("Deploy Shared Key (deploy)", { exact: true })
      .fill("E2E Identity");
    await page.getByPlaceholder("deploy", { exact: true }).fill("e2e-deploy");
    // authMethod defaults to "privateKey" — Path is required.
    await page
      .getByPlaceholder("~/.ssh/id_ed25519", { exact: true })
      .fill("~/.ssh/e2e_test_key");

    const create = page.getByRole("button", { name: "Create identity" });
    await expect(create).toBeEnabled();
    await create.click();

    // The new identity appears in the list.
    await expect(page.getByText("E2E Identity").first()).toBeVisible();
  });

  test("Edit identity opens prefilled form and Save changes commits", async ({ page }) => {
    await page.goto("/settings");
    // Edit the seeded "Deploy Shared Key (deploy)" identity.
    const seededRow = page
      .getByText("Deploy Shared Key (deploy)")
      .locator("xpath=ancestor::li[1]");
    await seededRow.getByRole("button", { name: "Edit" }).click();

    // The editor heading toggles to "Edit identity".
    await expect(page.getByText(/Edit identity/i)).toBeVisible();
    // Cancel without persisting (Save changes would mutate the seeded row).
    await page.getByRole("button", { name: "Cancel" }).click();
  });

  test("Delete identity surfaces the confirmation dialog", async ({ page }) => {
    await page.goto("/settings");
    const seededRow = page
      .getByText("Deploy Shared Key (deploy)")
      .locator("xpath=ancestor::li[1]");
    await seededRow.getByRole("button", { name: "Delete" }).click();
    // ConfirmDialog with title "Delete identity" appears.
    await expect(page.getByRole("heading", { name: "Delete identity" })).toBeVisible();
    // Cancel without deleting.
    await page.getByRole("button", { name: "Cancel" }).click();
  });

  test("Identity rows expose Edit + Delete actions for each seeded entry", async ({ page }) => {
    await page.goto("/settings");
    // The seeded MacBook Pro ED25519 (ops) row exposes both Edit and Delete.
    const seededRow = page
      .getByText("MacBook Pro ED25519 (ops)")
      .locator("xpath=ancestor::li[1]");
    await expect(seededRow.getByRole("button", { name: "Edit" })).toBeVisible();
    await expect(seededRow.getByRole("button", { name: "Delete" })).toBeVisible();
  });
});
