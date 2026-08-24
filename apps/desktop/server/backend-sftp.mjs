import {
  SFTP_CONTROL_TIMEOUT_MS,
  withDeadline as defaultWithDeadline,
} from "./backend-deadline.mjs";

export function createWithSftp({
  connectClient,
  withDeadline = defaultWithDeadline,
}) {
  /**
   * #182 slice 3: every SFTP operation now carries a deadline.
   *
   * ssh2 bounds only the INITIAL connect, via readyTimeout. Once connected, a
   * readdir or a write against a host that is reachable but unresponsive never
   * settled, so the request hung forever and the user had no way out.
   *
   * The deadline is armed AROUND the connect, not after it: a jump host whose
   * forwardOut never answers hangs before any channel exists, which a
   * post-connect timer would miss entirely.
   *
   * `timeoutMs` is per-operation because the workloads are not comparable — see
   * the constants in backend-deadline.mjs. `idle` is for the streamed download,
   * where a total budget ALONE would kill a large but perfectly healthy transfer;
   * callers there call `resetDeadline()` on observed progress.
   *
   * #288: `totalTimeoutMs` adds an optional ceiling on top of that idle budget.
   * The two answer different questions — idle asks whether anything arrived
   * recently, the ceiling asks how long this may run at all — and a drip-feeding
   * peer defeats the first while the second still ends it.
   *
   * Teardown on timeout is LIFO and uses destroy(), not the graceful end() of the
   * happy path: a graceful close negotiates with a peer that has already proven
   * unresponsive.
   */
  return async function withSftp(host, options, callback) {
    // Back-compat shape: withSftp(host, callback) means a control operation.
    if (typeof options === "function") {
      callback = options;
      options = {};
    }
    const { timeoutMs = SFTP_CONTROL_TIMEOUT_MS, totalTimeoutMs } = options;

    return withDeadline(timeoutMs, async ({ onTimeout, resetDeadline }) => {
      const client = await connectClient(host);
      onTimeout(() => client.destroy());

      try {
        const sftp = await new Promise((resolve, reject) => {
          client.sftp((error, sftpHandle) => {
            if (error) {
              reject(error);
              return;
            }

            resolve(sftpHandle);
          });
        });
        // Destroyed before the transport carrying it, so outstanding SFTP
        // callbacks cannot be left depending on a live channel.
        onTimeout(() => sftp.destroy?.());

        return await callback({ client, sftp, onTimeout, resetDeadline });
      } finally {
        client.end();
      }
    }, { totalTimeoutMs });
  };
}
