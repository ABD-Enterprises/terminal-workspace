import { describe, expect, it, vi } from "vitest";

import {
  OperationTimeoutError,
  REMOTE_COMMAND_TIMEOUT_MS,
  withDeadline,
} from "../../apps/desktop/server/backend-deadline.mjs";

// #182: ssh2 only bounds the INITIAL connect via readyTimeout. Once connected,
// an exec against a host that is reachable but unresponsive never settled — and
// because the snippet endpoint joins targets with Promise.all, one such host
// withheld every other host's result forever.
//
// Hangs are simulated with fake timers and a promise that never resolves, so
// nothing here waits on real wall-clock time; a 60-second deadline is asserted
// in milliseconds of test runtime.

describe("#182: operation deadlines", () => {
  it("rejects an operation that never settles, instead of waiting forever", async () => {
    vi.useFakeTimers();
    try {
      // The shape of the bug: a promise with no path to resolution.
      const hung = withDeadline(1_000, () => new Promise(() => {}));
      const asserted = expect(hung).rejects.toBeInstanceOf(OperationTimeoutError);

      await vi.advanceTimersByTimeAsync(1_000);
      await asserted;
    } finally {
      vi.useRealTimers();
    }
  });

  it("leaves a fast operation completely alone", async () => {
    vi.useFakeTimers();
    try {
      await expect(withDeadline(1_000, async () => "done")).resolves.toBe("done");
      // No timer may be left armed holding the process open.
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("tears down registered resources LIFO, innermost first", async () => {
    vi.useFakeTimers();
    try {
      const order: string[] = [];
      const hung = withDeadline(1_000, ({ onTimeout }) => {
        onTimeout(() => order.push("client"));
        onTimeout(() => order.push("stream"));
        return new Promise(() => {});
      });
      const asserted = expect(hung).rejects.toThrow(OperationTimeoutError);

      await vi.advanceTimersByTimeAsync(1_000);
      await asserted;

      // The stream is inside the client, so it must be destroyed first.
      expect(order).toEqual(["stream", "client"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("still runs later cleanups when one throws", async () => {
    vi.useFakeTimers();
    try {
      const order: string[] = [];
      const hung = withDeadline(1_000, ({ onTimeout }) => {
        onTimeout(() => order.push("client"));
        onTimeout(() => {
          throw new Error("this peer refuses to close");
        });
        return new Promise(() => {});
      });
      const asserted = expect(hung).rejects.toBeInstanceOf(OperationTimeoutError);

      await vi.advanceTimersByTimeAsync(1_000);
      await asserted;

      // An unresponsive peer can hang or throw on teardown exactly as easily as
      // on the operation. One failure must not strand the resources after it.
      expect(order).toEqual(["client"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not run cleanups for an operation that finished in time", async () => {
    vi.useFakeTimers();
    try {
      const cleanups: string[] = [];
      await withDeadline(1_000, async ({ onTimeout }) => {
        onTimeout(() => cleanups.push("must not run"));
        return "ok";
      });

      await vi.advanceTimersByTimeAsync(5_000);
      expect(cleanups).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("propagates the operation's own failure rather than masking it as a timeout", async () => {
    vi.useFakeTimers();
    try {
      await expect(
        withDeadline(1_000, async () => {
          throw new Error("connection refused");
        })
      ).rejects.toThrow("connection refused");
    } finally {
      vi.useRealTimers();
    }
  });

  it("carries the budget on the error, so the message can name it", () => {
    const error = new OperationTimeoutError("nope", REMOTE_COMMAND_TIMEOUT_MS);

    expect(error.timeoutMs).toBe(REMOTE_COMMAND_TIMEOUT_MS);
    expect(REMOTE_COMMAND_TIMEOUT_MS).toBe(60_000);
  });
});

describe("#182: the batch join no longer depends on every host answering", () => {
  it("completes a fan-out when one target hangs", async () => {
    vi.useFakeTimers();
    try {
      // Models the snippet endpoint: Promise.all over per-host operations, each
      // of which resolves to a result object rather than rejecting. Before the
      // deadline existed, the hung target left this pending forever.
      const runTarget = async (id: string, hang: boolean) => {
        try {
          return await withDeadline(1_000, () =>
            hang ? new Promise(() => {}) : Promise.resolve({ id, ok: true })
          );
        } catch (error) {
          return { id, ok: false, timedOut: error instanceof OperationTimeoutError };
        }
      };

      const batch = Promise.all([
        runTarget("fast-1", false),
        runTarget("hung", true),
        runTarget("fast-2", false),
      ]);

      await vi.advanceTimersByTimeAsync(1_000);

      expect(await batch).toEqual([
        { id: "fast-1", ok: true },
        { id: "hung", ok: false, timedOut: true },
        { id: "fast-2", ok: true },
      ]);
    } finally {
      vi.useRealTimers();
    }
  });
});
