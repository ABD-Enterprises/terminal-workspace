import { expect, it } from "vitest";

it("imports successfully", async () => {
  const mod = await import("./connection-secret-prompt-store");
  expect(mod).toBeDefined();
});
