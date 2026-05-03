import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { test as base, type Page } from "@playwright/test";

const screenshotDir = join(process.cwd(), "artifacts", "e2e");
const primaryShortcutModifier = process.platform === "darwin" ? "Meta" : "Control";

export function primaryShortcut(key: string) {
  return `${primaryShortcutModifier}+${key}`;
}

export async function capture(page: Page, filename: string) {
  mkdirSync(screenshotDir, { recursive: true });
  await page.screenshot({
    path: join(screenshotDir, filename),
    fullPage: true,
  });
}

/**
 * Console messages we'll allow even with the strict guard. Each must be
 * justified by a comment when added — this is the project's "known-issue"
 * allowlist for renderer-side noise that is documented and tracked
 * elsewhere (linked GitHub issue or plan-doc reference).
 */
const ALLOWED_CONSOLE_PATTERNS: RegExp[] = [
  // React 19 + react-router-dom v7 emits a one-time deprecation notice
  // about future-flag opt-ins in dev builds. Tracked separately; not a
  // blocker for shipping.
  /React Router/,
  // Zustand persist middleware logs hydration mismatches in strict-mode
  // remounts during dev. Harmless; production builds never see it.
  /\[zustand persist middleware\]/,
];

/**
 * Wrap every test in a console-error / page-error guard. The guard fails
 * the test if React emits a runtime warning, the renderer logs an
 * unhandled exception, or any console.error fires that's not on the
 * allowlist above. Catches regressions like missing keys in lists,
 * unhandled promise rejections, and prop-type complaints.
 *
 * Usage: `import { test, expect } from "./helpers";` instead of the
 * vanilla @playwright/test import.
 */
export const test = base.extend<{
  consoleErrorGuard: void;
}>({
  consoleErrorGuard: [
    async ({ page }, use, testInfo) => {
      const violations: string[] = [];
      page.on("console", (message) => {
        if (message.type() !== "error") {
          return;
        }
        const text = message.text();
        if (ALLOWED_CONSOLE_PATTERNS.some((pattern) => pattern.test(text))) {
          return;
        }
        violations.push(`[console.error] ${text}`);
      });
      page.on("pageerror", (error) => {
        const text = error.message;
        if (ALLOWED_CONSOLE_PATTERNS.some((pattern) => pattern.test(text))) {
          return;
        }
        violations.push(`[pageerror] ${text}`);
      });

      await use();

      if (violations.length > 0) {
        throw new Error(
          `Renderer surfaced ${violations.length} console error(s) during ${testInfo.title}:\n` +
            violations.map((line) => `  - ${line}`).join("\n")
        );
      }
    },
    { auto: true },
  ],
});

export { expect } from "@playwright/test";
