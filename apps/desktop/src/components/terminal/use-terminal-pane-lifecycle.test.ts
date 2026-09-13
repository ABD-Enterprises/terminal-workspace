import { expect, it } from "vitest";

const g = globalThis as unknown as Record<string, unknown>;
g.self = g;
g.window = g;
g.document = {
  createElement: () => ({
    getContext: () => null,
  }),
  getElementsByTagName: () => [],
};

it("maps executable host protocols to native session transports", async () => {
  const { resolveNativeSessionTransport } = await import("./use-terminal-pane-lifecycle");

  expect(resolveNativeSessionTransport("localShell")).toBe("localShell");
  expect(resolveNativeSessionTransport("telnet")).toBe("telnet");
  expect(resolveNativeSessionTransport("serial")).toBe("serial");
  expect(resolveNativeSessionTransport("mosh")).toBe("mosh");
  expect(resolveNativeSessionTransport("ssh")).toBe("ssh");
});
