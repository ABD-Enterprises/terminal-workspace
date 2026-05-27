import { expect, it } from "vitest";

it("imports successfully", async () => {
  const mod = await import("./transfers-store");
  expect(mod).toBeDefined();
});
