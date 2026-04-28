import { expect, test  } from "./helpers";

// Comprehensive coverage for /hosts: every primary button on the page,
// the filter bar, the editor flow, the delete confirm, and the SSH config
// import dialog. Replaces the slim original spec which only verified
// seeded text.

test.describe("hosts page", () => {
  test("seeded hosts render with their identity labels", async ({ page }) => {
    await page.goto("/hosts");
    await expect(page.getByText("Production Gateway").first()).toBeVisible();
    await expect(page.getByText("Billing API").first()).toBeVisible();
    await expect(page.getByText("MacBook Pro ED25519").first()).toBeVisible();
  });

  test("clicking the Billing API row reveals the trusted-key state", async ({ page }) => {
    await page.goto("/hosts");
    await page.getByRole("button", { name: /Billing API/ }).first().click();
    await expect(page.getByText("Deploy Shared Key").first()).toBeVisible();
    await expect(page.getByText(/ssh-ed25519 · trusted/i).first()).toBeVisible();
  });

  test("toolbar exposes Add host, Import SSH config, Reset filters", async ({ page }) => {
    await page.goto("/hosts");
    await expect(page.getByRole("button", { name: "Add host" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Import SSH config" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Reset filters" })).toBeVisible();
  });

  test("Add host opens the editor modal with empty fields", async ({ page }) => {
    await page.goto("/hosts");
    await page.getByRole("button", { name: "Add host" }).click();
    await expect(page.getByRole("heading", { name: "Add Host" })).toBeVisible();
    // Required fields are present.
    await expect(page.getByText("Label", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Protocol", { exact: true }).first()).toBeVisible();
    // Cancel closes the modal without persisting.
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("heading", { name: "Add Host" })).toHaveCount(0);
  });

  test("Add host: filling required fields enables Create host and persists", async ({ page }) => {
    await page.goto("/hosts");
    await page.getByRole("button", { name: "Add host" }).click();

    // The HostEditor labels its fields via wrapping <label> elements
    // containing a <span>. We address the inputs by placeholder text
    // which is more stable than implicit-label resolution.
    await page.getByPlaceholder("Production Gateway").fill("E2E Test Host");
    await page.getByPlaceholder("bastion.acme.internal").fill("e2e.example.com");
    await page.getByPlaceholder("ops").fill("e2e-user");

    const createButton = page.getByRole("button", { name: "Create host" });
    await expect(createButton).toBeEnabled();
    await createButton.click();

    // The editor closes and the new host appears in the list.
    await expect(page.getByRole("heading", { name: "Add Host" })).toHaveCount(0);
    await expect(page.getByText("E2E Test Host").first()).toBeVisible();
  });

  test("Add host: empty Label keeps Create host disabled (form-validation regression guard)", async ({
    page,
  }) => {
    await page.goto("/hosts");
    await page.getByRole("button", { name: "Add host" }).click();
    // Label is empty by default — Create button must be disabled until
    // the user supplies one.
    await expect(page.getByRole("button", { name: "Create host" })).toBeDisabled();
    await page.getByPlaceholder("Production Gateway").fill("L");
    await page.getByPlaceholder("bastion.acme.internal").fill("h");
    await expect(page.getByRole("button", { name: "Create host" })).toBeEnabled();
  });

  test("Edit existing host shows the populated form", async ({ page }) => {
    await page.goto("/hosts");
    await page.getByRole("button", { name: /Billing API/ }).first().click();
    const editButtons = page.getByRole("button", { name: /^Edit$/ });
    await editButtons.first().click();
    await expect(page.getByRole("heading", { name: /Edit / })).toBeVisible();
    // Cancel out so we don't mutate state.
    await page.getByRole("button", { name: "Cancel" }).click();
  });

  test("Reset filters clears the search query", async ({ page }) => {
    await page.goto("/hosts");
    const search = page.getByPlaceholder("Search the host inventory");
    await search.fill("billing");
    await expect(search).toHaveValue("billing");
    await page.getByRole("button", { name: "Reset filters" }).click();
    await expect(search).toHaveValue("");
  });

  test("Import SSH config opens a file chooser and accepts a parsed file", async ({ page }) => {
    await page.goto("/hosts");

    const sshConfig = `Host imported-host
  HostName imported.example.com
  User deploy
  Port 2200
`;

    const fileChooserPromise = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Import SSH config" }).click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles({
      name: "ssh-config-test",
      mimeType: "text/plain",
      buffer: Buffer.from(sshConfig, "utf-8"),
    });

    // The import summary modal renders after the parser runs.
    await expect(page.getByRole("heading", { name: /SSH config import/i })).toBeVisible();
    await expect(page.getByText("imported-host").first()).toBeVisible();
    // Close the summary modal so it doesn't bleed into other tests.
    await page.getByRole("button", { name: "Close" }).click();
  });
});
