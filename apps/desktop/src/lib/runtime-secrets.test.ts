import { expect, it } from "vitest";

it("imports successfully", async () => {
  const mod = await import("./runtime-secrets");
  expect(mod).toBeDefined();
});
