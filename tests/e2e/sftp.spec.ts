import { expect, test  } from "./helpers";

test("creates a folder in the demo transfer browser", async ({ page }) => {
  await page.goto("/transfers");

  await expect(page.getByRole("button", { name: /deploy\.log/ }).first()).toBeVisible();
  await page.getByRole("button", { name: "New folder" }).click();
  await page.getByPlaceholder("Folder name").fill("playwright-folder");
  await page.getByRole("button", { name: "Create folder" }).click();

  await expect(page.getByRole("button", { name: /playwright-folder/ }).first()).toBeVisible();
  await expect(page.getByText("ENOENT")).toHaveCount(0);
});
