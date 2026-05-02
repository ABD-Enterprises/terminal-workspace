import type { Page } from "@playwright/test";
import { expect, test } from "./helpers";

// Keyboard-first follow-through, list navigation half:
//   - On /hosts, j/k and ArrowDown/ArrowUp move the host selection.
//   - Typing j/k inside the search input is ignored (the user is typing
//     a literal letter).
//   - List nav is disabled while a modal is open.
//
// HostsPage is lazy-loaded — we MUST wait for a HostsPage-specific
// element ("Add host" button) before pressing keys, otherwise the hook
// hasn't mounted yet and the keypress hits a useless empty page. Real
// users never hit this (they can't press a key before they see the
// page), but Playwright's `goto` returns before the lazy chunk
// finishes mounting.

async function gotoHostsAndWait(page: Page) {
  await page.goto("/hosts");
  // Mount fence — when this is visible, HostsPage has rendered, the
  // useListKeyboardNavigation hook has registered its window listener,
  // and the seeded hosts are in the list.
  await expect(page.getByRole("button", { name: "Add host" })).toBeVisible();
  // Body click alone does not blur an input that auto-focused on load.
  // Force-blur whatever is currently active so j/k/Arrow keys reach the
  // list nav handler instead of getting eaten as text input.
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  });
}

test.describe("hosts list keyboard navigation", () => {
  test("j moves the selection (URL focus param appears)", async ({ page }) => {
    await gotoHostsAndWait(page);
    await page.keyboard.press("j");
    await expect(page).toHaveURL(/focus=/);
  });

  test("k moves the selection back to a different host", async ({ page }) => {
    await gotoHostsAndWait(page);
    await page.keyboard.press("j");
    await page.keyboard.press("j");
    const afterTwoJs = page.url();
    await page.keyboard.press("k");
    expect(page.url()).not.toBe(afterTwoJs);
    await expect(page).toHaveURL(/focus=/);
  });

  test("ArrowDown / ArrowUp work alongside j/k", async ({ page }) => {
    await gotoHostsAndWait(page);
    await page.keyboard.press("ArrowDown");
    await expect(page).toHaveURL(/focus=/);
    const afterArrow = page.url();
    await page.keyboard.press("ArrowUp");
    expect(page.url()).not.toBe(afterArrow);
  });

  test("typing j in the sidebar search inserts a literal j", async ({ page }) => {
    await page.goto("/hosts");
    const search = page.getByPlaceholder("Search the host inventory");
    await search.click();
    await search.fill("");
    await page.keyboard.press("j");
    // The search received "j"; the URL `focus` must NOT have changed.
    await expect(search).toHaveValue("j");
    await expect(page).not.toHaveURL(/focus=/);
    await search.fill("");
  });

  test("j navigation does not fire while a modal is open", async ({ page }) => {
    await gotoHostsAndWait(page);
    await page.getByRole("button", { name: "Add host" }).click();
    await expect(page.getByRole("heading", { name: "Add Host" })).toBeVisible();
    // List nav is disabled while the editor modal is open. Move focus
    // to a non-input control inside the modal and press j — the host
    // selection (URL ?focus= param) must not change.
    await page.evaluate(() => {
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
    });
    await page.getByRole("button", { name: "Esc" }).focus();
    const beforeUrl = page.url();
    await page.keyboard.press("j");
    expect(page.url()).toBe(beforeUrl);
    // Cancel out cleanly.
    await page.getByRole("button", { name: "Cancel" }).click();
  });
});
