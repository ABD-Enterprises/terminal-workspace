import { expect, it } from "vitest";

it("imports successfully", async () => {
  const mod = await import("./UpdateAvailableBanner");
  expect(mod.UpdateAvailableBanner).toBeDefined();
});
