import { expect, it } from "vitest";

it("imports successfully", async () => {
  const mod = await import("./TransfersPage");
  expect(mod).toBeDefined();
});
