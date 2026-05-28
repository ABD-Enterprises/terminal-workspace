import { expect, it } from "vitest";

it("imports successfully", async () => {
  const mod = await import("./FileBrowser");
  expect(mod).toBeDefined();
});
