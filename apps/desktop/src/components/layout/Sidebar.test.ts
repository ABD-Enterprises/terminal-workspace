import { expect, it } from "vitest";

it("imports successfully", async () => {
  const mod = await import("./Sidebar");
  expect(mod).toBeDefined();
});
