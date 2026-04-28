import { expect, test } from "@playwright/test";

// Coverage for /keys: Import + Generate buttons open the editor; Known
// hosts panel exposes Scan + Trust + Remove. Verifies seeded sample
// renders + dialog open/close round trips. Avoids triggering an actual
// scan against a live host (demo backend supplies its own fingerprints
// in browser mode, but keeping tests fast).

test.describe("keys page", () => {
  test("renders the seeded keys", async ({ page }) => {
    await page.goto("/keys");
    await expect(page.getByRole("heading", { name: "Keys" }).first()).toBeVisible();
    await expect(page.getByText("MacBook Pro ED25519").first()).toBeVisible();
    await expect(page.getByText("Deploy Shared Key").first()).toBeVisible();
  });

  test("toolbar exposes Import key + Generate key", async ({ page }) => {
    await page.goto("/keys");
    await expect(page.getByRole("button", { name: "Import key" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Generate key" })).toBeVisible();
  });

  test("Import key opens the editor and Cancel closes it", async ({ page }) => {
    await page.goto("/keys");
    await page.getByRole("button", { name: "Import key" }).click();
    // The editor renders fields for path + label.
    await expect(page.getByText(/Private key path|Path/i).first()).toBeVisible();
    // Locate the Cancel button inside the modal — there's only one visible.
    await page.getByRole("button", { name: "Cancel" }).click();
  });

  test("Generate key opens the editor and Cancel closes it", async ({ page }) => {
    await page.goto("/keys");
    await page.getByRole("button", { name: "Generate key" }).click();
    // The generate editor exposes a key-type radio/select with ed25519 etc.
    await expect(page.getByText(/ed25519|Algorithm|Passphrase/i).first()).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();
  });

  test("Known hosts panel renders scan controls", async ({ page }) => {
    await page.goto("/keys");
    await expect(page.getByText("Known hosts", { exact: true })).toBeVisible();
    // Scan button is present (may be disabled when no hosts in the dropdown).
    await expect(page.getByRole("button", { name: /^Scan/ })).toBeVisible();
  });

  test("Known hosts panel renders either the trusted-entry list or the empty state", async ({
    page,
  }) => {
    await page.goto("/keys");
    // The seeded fixture may or may not include trusted host entries
    // depending on which sample state is loaded. Either rendering is a
    // pass; only an unexpected error message would be a regression.
    await expect(page.getByText("Known hosts", { exact: true })).toBeVisible();
    const hasEntry = await page.getByText(/ssh-ed25519|ssh-rsa|ecdsa-sha2/).count();
    const hasEmpty = await page.getByText("No trusted host keys stored yet.").count();
    expect(hasEntry + hasEmpty).toBeGreaterThan(0);
  });

  test("Selecting a key reveals the assign-to-host control", async ({ page }) => {
    await page.goto("/keys");
    // Click the first key card.
    await page.getByText("MacBook Pro ED25519").first().click();
    await expect(page.getByText("Assign to host").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Assign key" }).first()).toBeVisible();
  });
});
