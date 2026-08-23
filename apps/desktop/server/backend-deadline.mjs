// Operation deadlines for the Node backend, kept out of backend.mjs so they can
// be tested without the module binding a port.

/** #182: a remote command's total budget, matching the native side's policy. */
export const REMOTE_COMMAND_TIMEOUT_MS = 60_000;

/**
 * #182 slice 3: SFTP budgets, argued from the workload rather than rounded.
 *
 * Control operations move almost no data. 30s is derived from ssh2's 10s
 * readyTimeout: room for two sequential handshakes on a jump route, plus
 * forwarding, SFTP subsystem setup, and one metadata call.
 *
 * Upload is a TOTAL budget because sftp.write's single callback exposes no
 * incremental progress to reset an idle timer against. The request cap is
 * 64 MiB of JSON+base64, so roughly 48 MiB of content; at a deliberately
 * pessimistic 256 KiB/s that is 192s, plus the 30s control allowance.
 *
 * Download is an IDLE budget — a large but progressing transfer must not be
 * killed, so any observed progress buys another interval.
 */
export const SFTP_CONTROL_TIMEOUT_MS = 30_000;
export const SFTP_UPLOAD_TIMEOUT_MS = 222_000;
export const SFTP_DOWNLOAD_IDLE_TIMEOUT_MS = 30_000;

/**
 * #288: the ceiling the idle budget cannot express.
 *
 * An idle deadline asks "has anything arrived recently", which a peer answers
 * trivially by sending one byte just inside every interval — that transfer is
 * never idle and so never dies, and the connection, the SFTP handle and the
 * response are held for as long as the peer cares to drip. The idle timer is
 * still the right primary bound (see above: a large but healthy transfer must
 * survive), so this is an ADDITIONAL ceiling rather than a replacement.
 *
 * Argued from the workload like its siblings: at the same deliberately
 * pessimistic 256 KiB/s used for the upload budget, 30 minutes covers roughly
 * 460 MiB. This endpoint backs an interactive file browser, so a legitimate
 * download here is orders of magnitude smaller than that — the ceiling is far
 * enough above the real workload that it cannot cut a healthy transfer, while
 * still bounding a drip-feeding peer to 30 minutes instead of forever.
 */
export const SFTP_DOWNLOAD_TOTAL_TIMEOUT_MS = 1_800_000;

export class OperationTimeoutError extends Error {
  constructor(message, timeoutMs) {
    super(message);
    this.name = "OperationTimeoutError";
    this.timeoutMs = timeoutMs;
    // #182: respondError honours a status the error carries, so a timeout that
    // is caught before response headers are sent surfaces as a 504 rather than
    // a generic 500. The sanitized MESSAGE is still generic by #230's policy —
    // the status is what tells the caller this was a timeout.
    this.statusCode = 504;
  }
}

/**
 * #182: race `operation` against a deadline, tearing down whatever it holds if
 * the deadline wins.
 *
 * The problem this solves: ssh2 only bounds the INITIAL connect, via
 * `readyTimeout`. Once connected, an exec against a server that is reachable but
 * unresponsive never settles — and `Promise.all` over a fan-out meant one such
 * host withheld every other host's result indefinitely.
 *
 * Three details are load-bearing:
 *
 * - The caller arms the deadline BEFORE connecting, not after. A jump host whose
 *   `forwardOut` never answers hangs before any channel exists, which is exactly
 *   the case a post-connect timer would miss.
 * - Cleanups run LIFO, innermost resource first, so a channel is destroyed
 *   before the transport carrying it.
 * - Cleanup is never awaited and each entry is isolated. An unresponsive peer
 *   can hang its own teardown just as easily as the operation, so a cleanup that
 *   throws or blocks must not prevent the ones after it, and none of them may
 *   delay the rejection.
 */
export function withDeadline(timeoutMs, run, options = {}) {
  // #288: an optional ABSOLUTE ceiling. Undefined keeps the pure-idle behaviour
  // every other caller relies on.
  const { totalTimeoutMs } = options;
  const startedAt = Date.now();
  const cleanups = [];
  // #182: three states, not a boolean. `timedOut` must be distinguishable from
  // `completed`, because a cleanup registered AFTER the deadline fired has to
  // run immediately rather than being queued for a timer that already went off,
  // and a progress event arriving after expiry must not re-arm anything.
  let state = "active";
  let timer;
  let fire;

  /**
   * Register a synchronous teardown. Later registrations run first, so an inner
   * resource (a stream) is destroyed before the transport carrying it.
   */
  const onTimeout = (cleanup) => {
    if (state === "timed_out") {
      // The connection resource appeared after the deadline already won. Nobody
      // else will ever close it, so close it now.
      runCleanup(cleanup);
      return;
    }
    cleanups.push(cleanup);
  };

  function runCleanup(cleanup) {
    try {
      cleanup();
    } catch {
      // Deliberately swallowed: one resource refusing to close must not strand
      // the others, and there is nothing useful to do with the error on a path
      // that is already failing.
    }
  }

  /**
   * Extend the deadline because the operation made observable progress.
   *
   * Only meaningful for an idle deadline — a streamed download that is slow but
   * alive must not be killed. Deliberately inert once the deadline has fired or
   * the operation finished: late progress cannot resurrect an expired budget.
   */
  /**
   * #288: arm the idle timer, clamped so it can never reach past the absolute
   * ceiling. Clamping the SAME timer (rather than adding a second one) is what
   * makes progress unable to outrun the ceiling: each reset can only ever move
   * the deadline to `min(idle, whatever remains of the total)`, so a peer
   * drip-feeding inside every idle interval still runs out of total budget.
   */
  function armTimer() {
    let delay = timeoutMs;
    // Which budget this arming will report if it expires.
    let expiredMs = timeoutMs;

    if (totalTimeoutMs !== undefined) {
      const remainingTotal = totalTimeoutMs - (Date.now() - startedAt);
      if (remainingTotal <= 0) {
        fire(totalTimeoutMs);
        return;
      }
      if (remainingTotal < delay) {
        delay = remainingTotal;
        expiredMs = totalTimeoutMs;
      }
    }

    timer = setTimeout(() => fire(expiredMs), delay);
    // Do not hold the event loop open purely for a pending deadline.
    timer.unref?.();
  }

  const resetDeadline = () => {
    if (state !== "active") {
      return;
    }
    clearTimeout(timer);
    armTimer();
  };

  const timeout = new Promise((_resolve, reject) => {
    // #288: the expired budget is a PARAMETER, because two different budgets can
    // now end this operation. `error.timeoutMs` is rendered to the user as
    // "did not finish within N seconds" (backend-command-operations.mjs), so a
    // ceiling expiry that reported the idle value would tell someone whose
    // download ran for 30 minutes that it timed out after 30 seconds.
    fire = (expiredMs = timeoutMs) => {
      if (state !== "active") {
        return;
      }
      state = "timed_out";
      for (const cleanup of cleanups.reverse()) {
        runCleanup(cleanup);
      }
      reject(
        new OperationTimeoutError(`operation did not finish within ${expiredMs}ms`, expiredMs)
      );
    };
    armTimer();
  });

  return Promise.race([
    Promise.resolve()
      .then(() => run({ onTimeout, resetDeadline }))
      .finally(() => {
        if (state === "active") {
          state = "completed";
        }
        clearTimeout(timer);
      }),
    timeout,
  ]);
}
