import { expect, test } from "./helpers";

const privateKeyBoundary = (kind: string, boundary: "BEGIN" | "END") =>
  `-----${boundary} ${kind} PRIVATE KEY-----`;

// Round 4: T11 keygen wizard copy + T12 ssh-copy-id + T13 paste from
// clipboard.

test.describe("T11: keygen wizard with explanations", () => {
  test("Generate key dialog lists type options with per-type guidance", async ({ page }) => {
    await page.goto("/keys");
    await expect(page.getByRole("button", { name: "Generate key" }).first()).toBeVisible();
    await page.getByRole("button", { name: "Generate key" }).first().click();
    await expect(page.getByRole("heading", { name: "Generate private key" })).toBeVisible();

    // Ed25519 is the default and is labeled (recommended).
    const typeSelect = page.getByLabel("Type", { exact: false });
    await expect(typeSelect).toHaveValue("ed25519");
    // The inline description is the modern-default copy.
    await expect(page.getByText(/Modern default\. Small key/)).toBeVisible();

    // Switch to ECDSA — description updates.
    await typeSelect.selectOption("ecdsa");
    await expect(page.getByText(/521-bit curve/)).toBeVisible();

    // Switch to RSA — description updates.
    await typeSelect.selectOption("rsa");
    await expect(page.getByText(/4096-bit RSA/)).toBeVisible();

    // Passphrase field carries the "recommended" hint.
    await expect(page.getByText("recommended", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Cancel" }).click();
  });
});

test.describe("T13: paste private key from clipboard", () => {
  test("Import dialog exposes a textarea for paste body + a Paste from clipboard button", async ({
    page,
  }) => {
    await page.goto("/keys");
    await page.getByRole("button", { name: "Import key" }).first().click();
    await expect(page.getByRole("heading", { name: "Import private key" })).toBeVisible();
    // The new paste area is present.
    await expect(page.getByText(/Paste key body \(optional\)/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Paste from clipboard" })).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();
  });

  test("Pasted body + path round-trips through importPrivateKeyFromBody (demo)", async ({
    page,
  }) => {
    await page.goto("/keys");
    await page.getByRole("button", { name: "Import key" }).first().click();
    // Fill the label + leave the default path + paste a valid key body.
    await page
      .getByPlaceholder("MacBook Pro ED25519")
      .fill("Pasted Test Key");
    const fakeBody = [
      privateKeyBoundary("OPENSSH", "BEGIN"),
      "fakeBase64DataHere",
      privateKeyBoundary("OPENSSH", "END"),
    ].join("\n");
    const textarea = page.locator("textarea").first();
    await textarea.fill(fakeBody);
    await page.getByRole("button", { name: "Import key" }).nth(1).click();
    // Editor closes and the new key appears in the list.
    await expect(page.getByRole("heading", { name: "Import private key" })).toHaveCount(0);
    await expect(page.getByText("Pasted Test Key").first()).toBeVisible();
  });

  test("Invalid pasted body surfaces an inline error", async ({ page }) => {
    await page.goto("/keys");
    await page.getByRole("button", { name: "Import key" }).first().click();
    await page.getByPlaceholder("MacBook Pro ED25519").fill("Bad Paste");
    const textarea = page.locator("textarea").first();
    // A plain password — should fail PEM header check.
    await textarea.fill("hunter2");
    await page.getByRole("button", { name: "Import key" }).nth(1).click();
    // Error banner appears with the validator message.
    await expect(page.getByText(/PEM/)).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();
  });
});

test.describe("T12: ssh-copy-id dialog", () => {
  test("KeyList rows expose a 'Copy to host…' action that opens the dialog", async ({ page }) => {
    await page.goto("/keys");
    // Seeded fixture has at least one key. Click Copy to host…
    const copyBtn = page.getByRole("button", { name: "Copy to host…" }).first();
    await expect(copyBtn).toBeVisible();
    await copyBtn.click();
    await expect(page.getByRole("heading", { name: /Copy ".+" to a host/ })).toBeVisible();
    // The Target host select renders with SSH hosts.
    await expect(page.getByLabel("Target host")).toBeVisible();
    // Cancel cleanly.
    await page.getByRole("button", { name: "Cancel" }).click();
  });

  test("Confirming the dialog issues the demo copy and surfaces a success banner", async ({
    page,
  }) => {
    await page.goto("/keys");
    await page.getByRole("button", { name: "Copy to host…" }).first().click();
    await page.getByRole("button", { name: "Copy key" }).click();
    // Success banner appears with the host label.
    await expect(page.getByRole("status").filter({ hasText: /Installed key on/ })).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();
  });
});
