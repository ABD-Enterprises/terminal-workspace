import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 45_000,
  fullyParallel: false,
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
        command: "node ./scripts/pnpmw.mjs --filter desktop exec vite --host 127.0.0.1 --port 4173",
        url: "http://127.0.0.1:4173/hosts",
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
