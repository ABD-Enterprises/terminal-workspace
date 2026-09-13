import { expect, it } from "vitest";
import { isQueuedCommandTransportPending } from "./use-terminal-pane-queued-commands";

it("treats native transports as pending until the socket is open", () => {
  expect(isQueuedCommandTransportPending({ transport: "ssh" }, null)).toBe(true);
  expect(isQueuedCommandTransportPending({ transport: "ssh" }, { readyState: WebSocket.CONNECTING } as WebSocket)).toBe(true);
  expect(isQueuedCommandTransportPending({ transport: "ssh" }, { readyState: WebSocket.OPEN } as WebSocket)).toBe(false);
});

it("does not wait on sockets for mock or unsupported panes", () => {
  expect(isQueuedCommandTransportPending({ transport: "mock" }, null)).toBe(false);
  expect(isQueuedCommandTransportPending({ transport: "unsupported" }, null)).toBe(false);
});
