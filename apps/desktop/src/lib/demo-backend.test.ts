import { expect, it } from "vitest";

it("imports successfully", async () => {
  const mod = await import("./demo-backend");
  expect(mod).toBeDefined();
});
