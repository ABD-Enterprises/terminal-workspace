import { expect, it } from "vitest";

it("imports successfully", async () => {
  const mod = await import("./backend-contract");
  expect(mod).toBeDefined();
});
