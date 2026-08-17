// Operation deadlines for the Node backend, kept out of backend.mjs so they can
// be tested without the module binding a port.

/** #182: a remote command's total budget, matching the native side's policy. */
export const REMOTE_COMMAND_TIMEOUT_MS = 60_000;

export class OperationTimeoutError extends Error {
  constructor(message, timeoutMs) {
    super(message);
    this.name = "OperationTimeoutError";
    this.timeoutMs = timeoutMs;
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
export function withDeadline(timeoutMs, run) {
  const cleanups = [];
  /** Register a synchronous teardown. Later registrations run first. */
  const onTimeout = (cleanup) => {
    cleanups.push(cleanup);
  };

  let timer;
  let settled = false;

  const timeout = new Promise((_resolve, reject) => {
    timer = setTimeout(() => {
      if (settled) {
        return;
      }
      for (const cleanup of cleanups.reverse()) {
        try {
          cleanup();
        } catch {
          // Deliberately swallowed: one resource refusing to close must not
          // strand the others, and there is nothing useful to do with the error
          // on a path that is already failing.
        }
      }
      reject(
        new OperationTimeoutError(`operation did not finish within ${timeoutMs}ms`, timeoutMs)
      );
    }, timeoutMs);
    // Do not hold the event loop open purely for a pending deadline.
    timer.unref?.();
  });

  return Promise.race([
    Promise.resolve()
      .then(() => run({ onTimeout }))
      .finally(() => {
        settled = true;
        clearTimeout(timer);
      }),
    timeout,
  ]);
}
