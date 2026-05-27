import { expect, it } from "vitest";

it("imports successfully", async () => {
  const mod = await import("./SnippetsPage");
  expect(mod).toBeDefined();
});
