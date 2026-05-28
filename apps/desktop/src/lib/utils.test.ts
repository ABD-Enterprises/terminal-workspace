import { expect, it } from "vitest";

it("imports successfully", async () => {
  const mod = await import("./utils");
  expect(mod).toBeDefined();
});
