import { expect, it } from "vitest";

it("imports successfully", async () => {
  const mod = await import("./auto-update");
  expect(mod).toBeDefined();
});
