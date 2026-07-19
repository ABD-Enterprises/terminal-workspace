import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: [
      "apps/desktop/src/**/*.test.ts",
      "apps/desktop/src/**/*.test.tsx",
      "tests/integration/**/*.test.ts",
    ],
    exclude: [
      "tests/e2e/**",
      "artifacts/**",
      "node_modules/**",
      "playwright-report/**",
      "src-tauri/**",
      "test-results/**",
    ],
    clearMocks: true,
    restoreMocks: true,
  },
});
