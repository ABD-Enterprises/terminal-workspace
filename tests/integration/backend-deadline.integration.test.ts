import { describe, expect, it, vi } from "vitest";

import {
  OperationTimeoutError,
  REMOTE_COMMAND_TIMEOUT_MS,
  SFTP_CONTROL_TIMEOUT_MS,
  SFTP_DOWNLOAD_IDLE_TIMEOUT_MS,
  SFTP_DOWNLOAD_TOTAL_TIMEOUT_MS,
  SFTP_UPLOAD_TIMEOUT_MS,
  withDeadline,
} from "../../apps/desktop/server/backend-deadline.mjs";
import { createWithSftp } from "../../apps/desktop/server/backend-sftp.mjs";

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

// #182 slice 3: the SFTP half. A streamed download needs an IDLE deadline —
// a large but progressing transfer must not be killed, only a silent one — and
// that means progress can extend the budget without ever being able to revive
// one that already expired.

describe("#182: idle deadlines extend on progress", () => {
  it("keeps a slow but progressing operation alive well past the interval", async () => {
    vi.useFakeTimers();
    try {
      let finish: (value: string) => void;
      const work = new Promise<string>((resolve) => {
        finish = resolve;
      });

      const running = withDeadline(1_000, ({ resetDeadline }) => {
        // Five ticks of progress, each just inside the idle window. A total
        // deadline would have killed this at 1s; an idle one must not.
        for (let tick = 1; tick <= 5; tick += 1) {
          setTimeout(() => resetDeadline(), tick * 900);
        }
        setTimeout(() => finish("streamed"), 5_000);
        return work;
      });

      await vi.advanceTimersByTimeAsync(5_000);
      await expect(running).resolves.toBe("streamed");
    } finally {
      vi.useRealTimers();
    }
  });

  it("still fires once progress stops", async () => {
    vi.useFakeTimers();
    try {
      const running = withDeadline(1_000, ({ resetDeadline }) => {
        setTimeout(() => resetDeadline(), 900);
        // Nothing after that — the stream went silent.
        return new Promise(() => {});
      });
      const asserted = expect(running).rejects.toBeInstanceOf(OperationTimeoutError);

      await vi.advanceTimersByTimeAsync(2_000);
      await asserted;
    } finally {
      vi.useRealTimers();
    }
  });

  it("cannot be resurrected by progress that arrives after it expired", async () => {
    vi.useFakeTimers();
    try {
      let lateReset: () => void;
      const running = withDeadline(1_000, ({ resetDeadline }) => {
        lateReset = resetDeadline;
        return new Promise(() => {});
      });
      const asserted = expect(running).rejects.toBeInstanceOf(OperationTimeoutError);

      await vi.advanceTimersByTimeAsync(1_000);
      await asserted;

      // A `data` event can still land after teardown began. It must be inert —
      // otherwise a dead operation quietly re-arms and leaks its resources.
      //
      // Measured IMMEDIATELY, before advancing: a re-armed timer would be
      // counted here and then silently consumed by any advance, which is how
      // the first version of this assertion passed with the guard removed.
      expect(vi.getTimerCount()).toBe(0);
      lateReset!();
      expect(vi.getTimerCount(), "a late reset must not arm a new timer").toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("closes a resource registered after the deadline already fired", async () => {
    vi.useFakeTimers();
    try {
      const closed: string[] = [];
      let registerLate: (cleanup: () => void) => void;

      const running = withDeadline(1_000, ({ onTimeout }) => {
        registerLate = onTimeout;
        return new Promise(() => {});
      });
      const asserted = expect(running).rejects.toBeInstanceOf(OperationTimeoutError);

      await vi.advanceTimersByTimeAsync(1_000);
      await asserted;

      // An async connect can resolve after the deadline won. Nobody else will
      // ever close that client, so registering it must close it immediately
      // rather than queueing it for a timer that already fired.
      registerLate!(() => closed.push("late client"));
      expect(closed).toEqual(["late client"]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("#182: the SFTP budgets are distinct and argued", () => {
  it("gives each workload its own value", () => {
    // Control ops move almost no data; upload is bounded by the request cap;
    // download is an idle interval rather than a ceiling.
    expect(SFTP_CONTROL_TIMEOUT_MS).toBe(30_000);
    expect(SFTP_UPLOAD_TIMEOUT_MS).toBe(222_000);
    expect(SFTP_DOWNLOAD_IDLE_TIMEOUT_MS).toBe(30_000);
    // Upload must exceed a control op by a wide margin, or a legitimate large
    // transfer would be cut off.
    expect(SFTP_UPLOAD_TIMEOUT_MS).toBeGreaterThan(SFTP_CONTROL_TIMEOUT_MS * 5);
  });

  it("carries a 504 so a pre-header timeout is not reported as a generic 500", () => {
    const error = new OperationTimeoutError("nope", SFTP_CONTROL_TIMEOUT_MS);

    // respondError honours a status the error carries (backend-responses.mjs).
    expect(error.statusCode).toBe(504);
    expect(REMOTE_COMMAND_TIMEOUT_MS).toBe(60_000);
  });
});


// #288: an idle deadline asks "did anything arrive recently". A peer answers
// that trivially by sending one byte just inside every interval, which is never
// idle and so never dies. These tests pin the ceiling that ends it, and — just
// as importantly — pin that the ceiling did NOT quietly replace the idle
// budget's reason for existing.
describe("#288: an idle download deadline cannot bound a drip-feeding peer", () => {
  it("terminates a peer that reports progress just inside every idle interval", async () => {
    vi.useFakeTimers();

    try {
      const IDLE = 1_000;
      const TOTAL = 5_000;
      let progressReports = 0;

      const pending = withDeadline(
        IDLE,
        async ({ resetDeadline }) => {
          // The drip: progress at 90% of the idle interval, forever. Against an
          // idle-only budget this operation is immortal.
          const drip = () => {
            progressReports += 1;
            resetDeadline();
            setTimeout(drip, IDLE * 0.9);
          };
          setTimeout(drip, IDLE * 0.9);

          // Never settles on its own — only a deadline can end it.
          return new Promise(() => {});
        },
        { totalTimeoutMs: TOTAL },
      );

      const assertion = expect(pending).rejects.toBeInstanceOf(OperationTimeoutError);

      // Well past the ceiling, and past many idle intervals the drip reset.
      await vi.advanceTimersByTimeAsync(TOTAL + IDLE);
      await assertion;

      // The reported budget must be the one that actually expired: this error
      // is rendered to the user as "did not finish within N seconds", and
      // reporting the 1s idle value for an operation that ran 5s is a lie.
      await expect(pending).rejects.toMatchObject({ timeoutMs: TOTAL });

      // The control on the control: if the drip had not actually been resetting
      // the deadline, this test would pass for the wrong reason — it would just
      // be observing the ordinary idle timeout. Progress must have been
      // reported more times than the idle budget would have tolerated.
      expect(progressReports).toBeGreaterThan(TOTAL / IDLE);
    } finally {
      vi.useRealTimers();
    }
  });

  it("fires at the ceiling exactly, not merely somewhere after it", async () => {
    // A test that advances well past the ceiling proves only that the operation
    // dies eventually. Pinning both sides of the boundary is what proves the
    // clamp uses the remaining total rather than some longer interval.
    vi.useFakeTimers();

    try {
      const IDLE = 1_000;
      const TOTAL = 5_000;
      let settled = false;

      const pending = withDeadline(
        IDLE,
        async ({ resetDeadline }) => {
          const drip = () => {
            resetDeadline();
            setTimeout(drip, IDLE * 0.9);
          };
          setTimeout(drip, IDLE * 0.9);
          return new Promise(() => {});
        },
        { totalTimeoutMs: TOTAL },
      );
      pending.catch(() => {
        settled = true;
      });

      await vi.advanceTimersByTimeAsync(TOTAL - 1);
      expect(settled).toBe(false);

      await vi.advanceTimersByTimeAsync(1);
      await expect(pending).rejects.toBeInstanceOf(OperationTimeoutError);
    } finally {
      vi.useRealTimers();
    }
  });

  it("still lets a slow but progressing transfer run past the ceiling when no ceiling is set", async () => {
    // NEGATIVE CONTROL. #182 chose an idle budget precisely so a large healthy
    // transfer survives. If the fix had been implemented by capping everything,
    // this test goes red — which is the whole point of keeping it.
    vi.useFakeTimers();

    try {
      const IDLE = 1_000;
      let settle: (value: string) => void = () => {};

      const pending = withDeadline(IDLE, async ({ resetDeadline }) => {
        const drip = () => {
          resetDeadline();
          setTimeout(drip, IDLE * 0.9);
        };
        setTimeout(drip, IDLE * 0.9);

        return new Promise<string>((resolve) => {
          settle = resolve;
        });
      });

      // No totalTimeoutMs: far beyond any ceiling, the transfer is still alive.
      await vi.advanceTimersByTimeAsync(SFTP_DOWNLOAD_TOTAL_TIMEOUT_MS * 2);
      settle("complete");

      await expect(pending).resolves.toBe("complete");
    } finally {
      vi.useRealTimers();
    }
  });

  it("lets silence end the operation at the idle budget, not at the ceiling", async () => {
    // The ceiling must be ADDITIONAL. If arming it had replaced the idle timer,
    // a silent peer would be tolerated for the full ceiling instead of dying
    // quickly, and this catches that regression.
    vi.useFakeTimers();

    try {
      const IDLE = 1_000;
      const TOTAL = 60_000;

      const pending = withDeadline(IDLE, async () => new Promise(() => {}), {
        totalTimeoutMs: TOTAL,
      });
      const assertion = expect(pending).rejects.toBeInstanceOf(OperationTimeoutError);

      // Only just past the idle budget — nowhere near the ceiling.
      await vi.advanceTimersByTimeAsync(IDLE + 50);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it("bounds the download endpoint's ceiling well above its idle budget", () => {
    // A ceiling at or below the idle budget would silently convert the download
    // into a total-budget operation and re-break what #182 fixed.
    expect(SFTP_DOWNLOAD_TOTAL_TIMEOUT_MS).toBeGreaterThan(SFTP_DOWNLOAD_IDLE_TIMEOUT_MS);
    expect(SFTP_DOWNLOAD_TOTAL_TIMEOUT_MS).toBe(1_800_000);
  });
});

describe("#323: withSftp threads the total timeout ceiling into the deadline", () => {
  it("passes totalTimeoutMs through to withDeadline", async () => {
    const sftp = { destroy: vi.fn() };
    const client = {
      destroy: vi.fn(),
      end: vi.fn(),
      sftp(callback: (error: Error | null, handle?: { destroy: () => void }) => void) {
        callback(null, sftp);
      },
    };
    const connectClient = vi.fn(async () => client);
    let receivedOptions: { totalTimeoutMs?: number } | undefined;
    const withDeadlineStub = vi.fn(async (_timeoutMs, operation, options) => {
      receivedOptions = options;
      return operation({
        onTimeout: vi.fn(),
        resetDeadline: vi.fn(),
      });
    });
    const withSftp = createWithSftp({
      connectClient,
      withDeadline: withDeadlineStub,
    });

    await withSftp(
      { hostname: "example.test" },
      { timeoutMs: 1_000, totalTimeoutMs: 5_000 },
      async () => "ok",
    );

    expect(withDeadlineStub).toHaveBeenCalledTimes(1);
    expect(withDeadlineStub).toHaveBeenCalledWith(
      1_000,
      expect.any(Function),
      { totalTimeoutMs: 5_000 },
    );
    expect(receivedOptions).toEqual({ totalTimeoutMs: 5_000 });
    expect(connectClient).toHaveBeenCalledWith({ hostname: "example.test" });
    expect(client.end).toHaveBeenCalledTimes(1);
  });
});
