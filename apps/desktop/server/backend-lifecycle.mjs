// Process-lifecycle helpers for the Node backend, factored out of backend.mjs
// so they can be unit-tested without starting the HTTP/WS server (backend.mjs
// binds a port the moment it is imported).

import { unlinkSync } from "node:fs";

/** Run a close/cleanup step, swallowing errors — shutdown must never throw. */
function closeQuietly(fn) {
  try {
    fn();
  } catch {
    // best-effort cleanup
  }
}

/**
 * Tear the backend down cleanly: end every live SSH client (and jump client),
 * close each session's websocket and shell stream, close every port-forward
 * server, close the websocket + HTTP servers, and remove the 0600 sidecar token
 * file. Without this a SIGINT/SIGTERM left dangling ssh2 clients, bound forward
 * ports, and a stale token on disk. Idempotent and never throws.
 */
export function shutdownBackend({ server, websocketServer, sessions, forwards, sidecarPath }) {
  if (sessions) {
    for (const session of sessions.values()) {
      closeQuietly(() => session.ws?.close());
      closeQuietly(() => session.stream?.close?.());
      closeQuietly(() => session.client?.end());
      closeQuietly(() => session.jumpClient?.end());
    }
    sessions.clear();
  }

  if (forwards) {
    for (const forward of forwards.values()) {
      closeQuietly(() => forward.server?.close());
    }
    forwards.clear();
  }

  closeQuietly(() => websocketServer?.close());
  closeQuietly(() => server?.close());

  if (sidecarPath) {
    closeQuietly(() => unlinkSync(sidecarPath));
  }
}

/**
 * A user-facing message for a fatal `server.listen` error we special-case
 * (currently only EADDRINUSE), or `null` if the caller should rethrow. Keeping
 * this pure makes the "friendly message + clean exit" path testable.
 */
export function describeServerListenError(error, port) {
  if (error?.code === "EADDRINUSE") {
    return `Port ${port} is already in use — another Terminal Workspace backend is probably already running. Close it, or set TERMSNIP_BACKEND_PORT to a free port, and try again.`;
  }
  return null;
}
