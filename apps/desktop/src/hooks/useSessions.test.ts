import { expect, it } from "vitest";

it("imports successfully", async () => {
  const mod = await import("./useSessions");
  expect(mod).toBeDefined();
});
