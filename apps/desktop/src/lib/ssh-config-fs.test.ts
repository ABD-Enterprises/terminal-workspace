import { expect, it } from "vitest";

it("imports successfully", async () => {
  const mod = await import("./ssh-config-fs");
  expect(mod).toBeDefined();
});
