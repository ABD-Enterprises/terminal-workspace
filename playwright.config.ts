import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 45_000,
  fullyParallel: false,
  /*
   * #149: `trace: "on-first-retry"` below was dead configuration — with no
   * retries there is never a first retry, so the trace it asks for could never
   * be produced and every flake failed with nothing to diagnose it by.
   *
   * One retry, CI only: enough to capture the trace, not enough to grind
   * through a genuinely broken test. `failOnFlakyTests` is what keeps this from
   * weakening the gate — a test that fails then passes still fails the run, so
   * the retry buys evidence rather than tolerance.
   */
  retries: process.env.CI ? 1 : 0,
  failOnFlakyTests: Boolean(process.env.CI),
  reporter: process.env.CI ? "github" : [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: process.env.TERMSNIP_E2E_BASE_URL ?? "http://127.0.0.1:4173",
    browserName: "chromium",
    viewport: {
      width: 1440,
      height: 1024,
    },
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer: process.env.TERMSNIP_E2E_BASE_URL
    ? undefined
    : {
        command: "cd ./apps/desktop && ./node_modules/.bin/vite --host 127.0.0.1 --port 4173",
        url: "http://127.0.0.1:4173/",
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
