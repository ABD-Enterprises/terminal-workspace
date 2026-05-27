import { expect, it } from "vitest";

it("imports successfully", async () => {
  const mod = await import("./shortcuts");
  expect(mod).toBeDefined();
});
