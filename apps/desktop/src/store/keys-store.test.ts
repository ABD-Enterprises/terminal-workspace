import { expect, it } from "vitest";

it("imports successfully", async () => {
  const mod = await import("./keys-store");
  expect(mod).toBeDefined();
});
