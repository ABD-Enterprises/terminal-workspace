import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";

const screenshotDir = join(process.cwd(), "artifacts", "e2e");

export async function capture(page: Page, filename: string) {
  mkdirSync(screenshotDir, { recursive: true });
  await page.screenshot({
    path: join(screenshotDir, filename),
    fullPage: true,
  });
}
