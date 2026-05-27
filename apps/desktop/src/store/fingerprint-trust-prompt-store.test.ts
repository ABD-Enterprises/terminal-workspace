import { expect, it } from "vitest";

it("imports successfully", async () => {
  const mod = await import("./fingerprint-trust-prompt-store");
  expect(mod).toBeDefined();
});
