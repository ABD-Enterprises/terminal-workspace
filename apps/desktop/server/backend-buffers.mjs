// Memory-bounding helpers for the Node backend, factored out of backend.mjs so
// they can be unit-tested without the module binding a port on import.

/** Max control-payload request body (host configs, paths, …) before a 413. */
export const REQUEST_BODY_MAX_BYTES = 1 * 1024 * 1024; // 1 MiB
/** Higher cap for the SFTP upload route, which POSTs base64 file contents. */
export const SFTP_UPLOAD_MAX_BYTES = 64 * 1024 * 1024; // 64 MiB (~48 MB file)
/** Max bytes of terminal output held for a session while its ws is detached. */
export const SESSION_BUFFER_MAX_BYTES = 256 * 1024; // 256 KiB

export class PayloadTooLargeError extends Error {
  constructor(limit) {
    super(`Request body exceeds the ${limit}-byte limit.`);
    this.name = "PayloadTooLargeError";
    this.statusCode = 413;
  }
}

/**
 * Read and JSON-parse a request body, rejecting with a 413 PayloadTooLargeError
 * once the accumulated bytes exceed `maxBytes`. Without the cap, a buggy or
 * hostile (but authenticated) renderer POSTing a huge body — e.g. an SFTP
 * upload's base64 contents — buffers the whole payload in memory and can OOM
 * the single backend process that owns every session.
 *
 * Uses event-based reading rather than `for await`: throwing out of a
 * `for await` over an http IncomingMessage destroys the socket, so the caller's
 * response.end() would hit a dead connection and the client would see
 * ECONNRESET instead of the 413. Here we reject (and pause) without tearing
 * down the socket, so the caller can still send the status.
 */
export function readJson(request, maxBytes = REQUEST_BODY_MAX_BYTES) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, value) => {
      if (settled) {
        return;
      }
      settled = true;
      fn(value);
    };

    // Fast path: reject before reading a byte when the declared length already
    // exceeds the cap.
    const declared = Number(request.headers?.["content-length"]);
    if (Number.isFinite(declared) && declared > maxBytes) {
      finish(reject, new PayloadTooLargeError(maxBytes));
      return;
    }

    const chunks = [];
    let total = 0;

    request.on("data", (chunk) => {
      if (settled) {
        return;
      }
      total += chunk.length;
      if (total > maxBytes) {
        request.pause();
        finish(reject, new PayloadTooLargeError(maxBytes));
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      try {
        finish(resolve, JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch (error) {
        finish(reject, error);
      }
    });
    request.on("error", (error) => finish(reject, error));
  });
}

/**
 * Append terminal output to a detached session's replay buffer, evicting the
 * oldest chunks once the buffer exceeds `maxBytes` (drop-oldest) and tracking
 * how many bytes were dropped, so the client can be told on reconnect. Without a
 * cap, a chatty session whose ws is detached (mid-reconnect or after a network
 * flap) accumulates output without bound. Mutates `session`; expects
 * `session.buffer` (array), `session.bufferBytes` and `session.droppedBytes`
 * (numbers) to be initialized.
 */
export function bufferDetachedOutput(session, data, maxBytes = SESSION_BUFFER_MAX_BYTES) {
  session.buffer.push(data);
  session.bufferBytes += Buffer.byteLength(data, "utf8");
  // Keep at least the most recent chunk even if it alone exceeds the cap.
  while (session.bufferBytes > maxBytes && session.buffer.length > 1) {
    const evicted = session.buffer.shift();
    const evictedBytes = Buffer.byteLength(evicted, "utf8");
    session.bufferBytes -= evictedBytes;
    session.droppedBytes += evictedBytes;
  }
}
