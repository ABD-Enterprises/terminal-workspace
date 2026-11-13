import { describe, expect, it } from "vitest";
import type { TransferItem } from "../types/transfer";
import {
  countActiveTransfers,
  hasActiveTransfers,
  isActiveTransfer,
} from "./transfers-store";

function item(overrides: Partial<TransferItem>): TransferItem {
  return {
    id: "t1",
    hostId: "h1",
    hostLabel: "web-1",
    direction: "download",
    name: "dump.sql",
    remotePath: "/tmp/dump.sql",
    status: "queued",
    createdAt: "2026-11-13T00:00:00.000Z",
    updatedAt: "2026-11-13T00:00:00.000Z",
    ...overrides,
  };
}

describe("transfer activity helpers", () => {
  it("treats queued and running as active, completed and failed as terminal", () => {
    expect(isActiveTransfer(item({ status: "queued" }))).toBe(true);
    expect(isActiveTransfer(item({ status: "running" }))).toBe(true);
    expect(isActiveTransfer(item({ status: "completed" }))).toBe(false);
    expect(isActiveTransfer(item({ status: "failed" }))).toBe(false);
  });

  it("counts active transfers, optionally filtered by host", () => {
    const queue = [
      item({ id: "t1", hostId: "h1", status: "running" }),
      item({ id: "t2", hostId: "h1", status: "queued" }),
      item({ id: "t3", hostId: "h2", status: "completed" }),
      item({ id: "t4", hostId: "h2", status: "failed" }),
    ];

    expect(countActiveTransfers(queue)).toBe(2);
    expect(countActiveTransfers(queue, "h1")).toBe(2);
    expect(countActiveTransfers(queue, "h2")).toBe(0);
  });

  it("reports no active transfers for an empty queue", () => {
    expect(hasActiveTransfers([])).toBe(false);
    expect(hasActiveTransfers([item({ status: "completed" })])).toBe(false);
    expect(hasActiveTransfers([item({ status: "running" })])).toBe(true);
  });
});
