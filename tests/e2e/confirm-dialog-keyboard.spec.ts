import { expect, test } from "./helpers";

// Keyboard-first follow-through, confirm-dialog half:
//   - In a destructive ConfirmDialog (Delete host), Enter triggers
//     the confirm action — same as clicking Delete host.
//   - The confirm button is autoFocused so screen-reader and keyboard
//     users land on the destructive control with one Tab less than
//     before.
//
// UX-13: the identity delete flow is undoable now (no dialog), so these
// assertions target the host delete dialog, which still confirms up front
// because its cascade touches live sessions and stored secrets.

test.describe("ConfirmDialog keyboard handling", () => {
  test("Enter triggers the confirm action (delete host flow)", async ({ page }) => {
    await page.goto("/hosts");

    // Locate any seeded host card's Delete button. The browser demo seeds
    // sample hosts, so at least one is present.
    const deleteButtons = page.getByRole("button", { name: /^Delete$/ });
    if ((await deleteButtons.count()) === 0) {
      // Seed empty — nothing to assert.
      return;
    }

    await deleteButtons.first().click();
    // The confirm dialog renders with role=dialog.
    await expect(page.getByRole("dialog")).toBeVisible();

    // Capture how many host cards are visible BEFORE the destructive
    // confirm. After Enter, that count should drop by one.
    const beforeCardCount = await page.getByRole("button", { name: /^Delete$/ }).count();

    await page.keyboard.press("Enter");

    // The dialog closes — host was deleted.
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const afterCardCount = await page.getByRole("button", { name: /^Delete$/ }).count();
    expect(afterCardCount).toBe(beforeCardCount - 1);
  });

  test("Esc cancels without confirming (delete-host flow)", async ({ page }) => {
    await page.goto("/hosts");

    const deleteButtons = page.getByRole("button", { name: /^Delete$/ });
    if ((await deleteButtons.count()) === 0) {
      return;
    }

    const beforeCardCount = await deleteButtons.count();
    await deleteButtons.first().click();
    await expect(page.getByRole("dialog")).toBeVisible();

    await page.keyboard.press("Escape");
    // Esc closes the modal via Modal's own handler. The card count must
    // be unchanged.
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const afterCardCount = await page.getByRole("button", { name: /^Delete$/ }).count();
    expect(afterCardCount).toBe(beforeCardCount);
  });
});

