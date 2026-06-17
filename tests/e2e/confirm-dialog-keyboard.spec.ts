import { expect, test } from "./helpers";

// Keyboard-first follow-through, confirm-dialog half:
//   - In a destructive ConfirmDialog (Delete identity), Enter triggers
//     the confirm action — same as clicking Delete.
//   - The confirm button is autoFocused so screen-reader and keyboard
//     users land on the destructive control with one Tab less than
//     before.

test.describe("ConfirmDialog keyboard handling", () => {
  test("Enter triggers the confirm action (delete identity flow)", async ({ page }) => {
    await page.goto("/settings");

    // Locate any seeded identity row's Delete button. The seed contains
    // at least one identity per internal/parity-and-hardening-plan.md P2-DM1.
    const deleteButtons = page.getByRole("button", { name: /^Delete$/ });
    if ((await deleteButtons.count()) === 0) {
      // Seed empty — nothing to assert.
      return;
    }

    await deleteButtons.first().click();
    // The confirm dialog renders with role=dialog.
    await expect(page.getByRole("dialog")).toBeVisible();

    // Capture how many identity rows are visible BEFORE the destructive
    // confirm. After Enter, that count should drop by one.
    const beforeRowCount = await page.getByRole("button", { name: /^Delete$/ }).count();

    await page.keyboard.press("Enter");

    // The dialog closes — identity was deleted.
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const afterRowCount = await page.getByRole("button", { name: /^Delete$/ }).count();
    expect(afterRowCount).toBe(beforeRowCount - 1);
  });

  test("Esc cancels without confirming (delete-identity flow)", async ({ page }) => {
    await page.goto("/settings");

    const deleteButtons = page.getByRole("button", { name: /^Delete$/ });
    if ((await deleteButtons.count()) === 0) {
      return;
    }

    const beforeRowCount = await deleteButtons.count();
    await deleteButtons.first().click();
    await expect(page.getByRole("dialog")).toBeVisible();

    await page.keyboard.press("Escape");
    // Esc closes the modal via Modal's own handler. The row count must
    // be unchanged.
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const afterRowCount = await page.getByRole("button", { name: /^Delete$/ }).count();
    expect(afterRowCount).toBe(beforeRowCount);
  });
});
