import { expect, it } from "vitest";
import { resolveNativeSessionTransport } from "./terminal-pane-transport";

it("maps executable host protocols to native session transports", () => {
  expect(resolveNativeSessionTransport("localShell")).toBe("localShell");
  expect(resolveNativeSessionTransport("telnet")).toBe("telnet");
  expect(resolveNativeSessionTransport("serial")).toBe("serial");
  expect(resolveNativeSessionTransport("mosh")).toBe("mosh");
  expect(resolveNativeSessionTransport("ssh")).toBe("ssh");
});
