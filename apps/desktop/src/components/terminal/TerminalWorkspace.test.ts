import { expect, it } from "vitest";

// Stub globals for xterm compatibility in node environment
const g = globalThis as unknown as Record<string, unknown>;
g.self = g;
g.window = g;
g.document = {
  createElement: () => ({
    getContext: () => null,
  }),
  getElementsByTagName: () => [],
};

it("imports successfully", async () => {
  const mod = await import("./TerminalWorkspace");
  expect(mod).toBeDefined();
});
