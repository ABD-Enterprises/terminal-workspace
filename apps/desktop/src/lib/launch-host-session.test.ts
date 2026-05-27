import { expect, it } from "vitest";

it("imports successfully", async () => {
  const mod = await import("./launch-host-session");
  expect(mod).toBeDefined();
});
