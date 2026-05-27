import { expect, it } from "vitest";

it("imports successfully", async () => {
  const mod = await import("./native-secrets");
  expect(mod).toBeDefined();
});
