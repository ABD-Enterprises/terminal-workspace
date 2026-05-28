import { expect, it } from "vitest";

it("imports successfully", async () => {
  const mod = await import("./useAppShellTheme");
  expect(mod).toBeDefined();
});
