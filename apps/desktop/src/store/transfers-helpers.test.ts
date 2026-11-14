// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import type { TransferItem } from "../types/transfer";
import {
  countActiveTransfers,
  hasActiveTransfers,
  INTERRUPTED_TRANSFER_MESSAGE,
  isActiveTransfer,
  normalizeHydratedQueue,
  trimTransferQueue,
  useTransfersStore,
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

describe("normalizeHydratedQueue", () => {
  it("marks persisted queued and running transfers failed as interrupted", () => {
    const result = normalizeHydratedQueue([
      item({ id: "a", status: "queued" }),
      item({ id: "b", status: "running" }),
      item({ id: "c", status: "completed" }),
      item({ id: "d", status: "failed", errorMessage: "boom" }),
    ]);

    expect(result.map((entry) => entry.status)).toEqual([
      "failed",
      "failed",
      "completed",
      "failed",
    ]);
    expect(result[0].errorMessage).toBe(INTERRUPTED_TRANSFER_MESSAGE);
    expect(result[1].errorMessage).toBe(INTERRUPTED_TRANSFER_MESSAGE);
    expect(result[3].errorMessage).toBe("boom");
    expect(hasActiveTransfers(result)).toBe(false);
  });

  it("tolerates a missing or malformed queue", () => {
    expect(normalizeHydratedQueue(undefined)).toEqual([]);
    expect(normalizeHydratedQueue("nope")).toEqual([]);
  });
});

describe("transfers store hydration", () => {
  it("does not restore an interrupted transfer as live", async () => {
    localStorage.setItem(
      "terminal-workspace-transfers",
      JSON.stringify({
        state: {
          remotePathByHost: {},
          queue: [item({ id: "r1", status: "running" }), item({ id: "q1", status: "queued" })],
        },
        version: 0,
      })
    );

    await useTransfersStore.persist.rehydrate();

    const { queue } = useTransfersStore.getState();
    expect(queue.map((entry) => entry.status)).toEqual(["failed", "failed"]);
    expect(hasActiveTransfers(queue)).toBe(false);
    localStorage.removeItem("terminal-workspace-transfers");
  });
});

describe("trimTransferQueue", () => {
  const many = (count: number, status: TransferItem["status"], prefix: string) =>
    Array.from({ length: count }, (_, index) => item({ id: `${prefix}${index}`, status }));

  it("leaves a queue within the limit untouched", () => {
    const queue = [...many(3, "running", "r"), ...many(3, "completed", "c")];
    expect(trimTransferQueue(queue)).toEqual(queue);
  });

  it("drops the oldest finished entries first", () => {
    const queue = many(30, "completed", "c");
    const trimmed = trimTransferQueue(queue);
    expect(trimmed).toHaveLength(24);
    expect(trimmed[0].id).toBe("c0");
    expect(trimmed[23].id).toBe("c23");
  });

  it("never evicts a running or queued transfer, even behind 24 newer ones", () => {
    const queue = [...many(24, "completed", "new"), item({ id: "old-running", status: "running" }), item({ id: "old-queued", status: "queued" })];
    const trimmed = trimTransferQueue(queue);
    const ids = trimmed.map((entry) => entry.id);
    expect(ids).toContain("old-running");
    expect(ids).toContain("old-queued");
    expect(trimmed).toHaveLength(24);
    expect(hasActiveTransfers(trimmed)).toBe(true);
  });

  it("keeps every live transfer even when they alone exceed the limit", () => {
    const queue = [...many(30, "running", "r"), ...many(5, "completed", "c")];
    const trimmed = trimTransferQueue(queue);
    expect(trimmed).toHaveLength(30);
    expect(countActiveTransfers(trimmed)).toBe(30);
  });
});

describe("queueTransfer", () => {
  it("keeps an old running transfer after 24 newer ones are queued", () => {
    useTransfersStore.setState({ queue: [] });
    const store = useTransfersStore.getState();
    const first = store.queueTransfer({
      hostId: "h1",
      hostLabel: "web-1",
      direction: "upload",
      name: "first.bin",
      remotePath: "/tmp/first.bin",
    });
    store.markTransferRunning(first);
    for (let index = 0; index < 24; index += 1) {
      store.queueTransfer({
        hostId: "h1",
        hostLabel: "web-1",
        direction: "upload",
        name: `f${index}.bin`,
        remotePath: `/tmp/f${index}.bin`,
      });
    }

    const { queue } = useTransfersStore.getState();
    expect(queue.some((entry) => entry.id === first)).toBe(true);
    expect(hasActiveTransfers(queue, "h1")).toBe(true);
    useTransfersStore.setState({ queue: [] });
  });
});
