import { expect, it } from "vitest";

it("imports successfully", async () => {
  const mod = await import("./dock-badge");
  expect(mod).toBeDefined();
});
