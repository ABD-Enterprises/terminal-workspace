import { expect, test } from "./helpers";

// Regression coverage for the Modal scroll contract.
//
// The user reported that the Add host dialog was unreachable on a 13" MBP
// screenshot — the form overflowed the viewport and the Cancel/Create
// buttons sat below the fold with no way to reach them. Root cause was
// the Modal frame having no max-height constraint and no internal scroll
// region, while the body had `overflow: hidden` set to lock background
// scrolling. The fix turns the dialog into a flex column with a hard
// max-height, a pinned shrink-0 header + footer, and a scrollable
// `min-h-0 flex-1 overflow-y-auto` body.
//
// Default Playwright viewport (1440x1024) is tall enough that the bug
// never reproduced in the existing hosts/identity/key/snippet specs.
// This file deliberately drops the viewport to 1280x720 — a 13" MBP with
// the dock visible — and asserts the contract for every editor modal
// the app exposes.
//
// If you add a new editor modal, please add a case here.

test.use({ viewport: { width: 1280, height: 720 } });

test.describe("modal viewport contract (1280x720)", () => {
  test("Add host: Create host button is reachable on a short viewport", async ({ page }) => {
    await page.goto("/hosts");
    await page.getByRole("button", { name: "Add host" }).click();
    await expect(page.getByRole("heading", { name: "Add Host" })).toBeVisible();

    const createButton = page.getByRole("button", { name: "Create host" });
    const cancelButton = page.getByRole("button", { name: "Cancel" });

    // The action buttons must be in the visible viewport without the user
    // having to scroll the page (only the modal body should scroll).
    await expect(createButton).toBeInViewport();
    await expect(cancelButton).toBeInViewport();

    // The modal frame must respect the viewport. We check the dialog
    // bounding box fits within the visible page height with a small
    // margin for the outer padding (py-10 on the backdrop = 80px total).
    const dialog = page.getByRole("dialog");
    const box = await dialog.boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      expect(box.height).toBeLessThanOrEqual(720);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height).toBeLessThanOrEqual(720);
    }

    // And the body must actually scroll — a scrollHeight greater than
    // the clientHeight of the scroll container proves the form content
    // exceeded what fits and the overflow region took over.
    const scrollable = page.locator('div[role="dialog"] > div.overflow-y-auto');
    const scrollMetrics = await scrollable.evaluate((node) => ({
      scrollHeight: node.scrollHeight,
      clientHeight: node.clientHeight,
    }));
    expect(scrollMetrics.scrollHeight).toBeGreaterThan(scrollMetrics.clientHeight);

    // Sanity: clicking Cancel still closes the modal — no overlay is
    // sitting in front of the footer blocking pointer events.
    await cancelButton.click();
    await expect(page.getByRole("heading", { name: "Add Host" })).toHaveCount(0);
  });

  test("Add host: filling required fields and clicking Create persists from a short viewport", async ({
    page,
  }) => {
    await page.goto("/hosts");
    await page.getByRole("button", { name: "Add host" }).click();

    await page.getByPlaceholder("Production Gateway").fill("Viewport Regression Host");
    await page.getByPlaceholder("bastion.acme.internal").fill("vp.example.com");
    await page.getByPlaceholder("ops").fill("vp-user");

    const createButton = page.getByRole("button", { name: "Create host" });
    await expect(createButton).toBeInViewport();
    await expect(createButton).toBeEnabled();
    await createButton.click();

    await expect(page.getByRole("heading", { name: "Add Host" })).toHaveCount(0);
    await expect(page.getByText("Viewport Regression Host").first()).toBeVisible();
  });

  test("Identity editor (Settings): Create identity button is reachable", async ({ page }) => {
    await page.goto("/settings");
    // The IdentityEditor is inline (not a Modal), but we still check the
    // surrounding panel form is reachable on short screens. If you Edit
    // an existing identity the form opens inline below the row — verify
    // the Save changes button is visible.
    const editButtons = page.getByRole("button", { name: /^Edit$/ });
    if ((await editButtons.count()) === 0) {
      // No identities seeded for this fixture — nothing to assert.
      return;
    }
    await editButtons.first().click();
    const saveButton = page.getByRole("button", { name: /Save changes|Create identity/ });
    await expect(saveButton.first()).toBeInViewport();
  });

  test("Snippet editor: Save / action buttons reachable on a short viewport", async ({ page }) => {
    await page.goto("/snippets");
    await page.getByRole("button", { name: "New snippet" }).click();

    // SnippetEditor uses Modal too — assert the action footer is in the
    // viewport. The Cancel button is always present.
    const cancelButton = page.getByRole("button", { name: "Cancel" });
    await expect(cancelButton).toBeInViewport();

    // Modal frame height check.
    const dialog = page.getByRole("dialog");
    const box = await dialog.boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      expect(box.height).toBeLessThanOrEqual(720);
      expect(box.y + box.height).toBeLessThanOrEqual(720);
    }

    await cancelButton.click();
  });

  test("Key editor (Import key): Import + Cancel reachable on a short viewport", async ({
    page,
  }) => {
    await page.goto("/keys");
    await page.getByRole("button", { name: "Import key" }).click();
    await expect(page.getByRole("heading", { name: "Import private key" })).toBeVisible();

    await expect(page.getByRole("button", { name: "Import key" }).nth(1)).toBeInViewport();
    await expect(page.getByRole("button", { name: "Cancel" })).toBeInViewport();

    const dialog = page.getByRole("dialog");
    const box = await dialog.boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      expect(box.height).toBeLessThanOrEqual(720);
      expect(box.y + box.height).toBeLessThanOrEqual(720);
    }

    await page.getByRole("button", { name: "Cancel" }).click();
  });

  test("Key editor (Generate key): Generate + Cancel reachable on a short viewport", async ({
    page,
  }) => {
    await page.goto("/keys");
    await page.getByRole("button", { name: "Generate key" }).click();
    await expect(page.getByRole("heading", { name: "Generate private key" })).toBeVisible();

    await expect(page.getByRole("button", { name: "Generate key" }).nth(1)).toBeInViewport();
    await expect(page.getByRole("button", { name: "Cancel" })).toBeInViewport();

    const dialog = page.getByRole("dialog");
    const box = await dialog.boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      expect(box.height).toBeLessThanOrEqual(720);
      expect(box.y + box.height).toBeLessThanOrEqual(720);
    }

    await page.getByRole("button", { name: "Cancel" }).click();
  });
});
