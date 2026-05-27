import { expect, it } from "vitest";

it("imports successfully", async () => {
  const mod = await import("./known-hosts-store");
  expect(mod).toBeDefined();
});
