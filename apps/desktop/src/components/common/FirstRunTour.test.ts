import { expect, it } from "vitest";

it("imports successfully", async () => {
  const mod = await import("./FirstRunTour");
  expect(mod).toBeDefined();
});
