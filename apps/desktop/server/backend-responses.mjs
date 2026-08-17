// JSON response helpers for the Node backend, factored out of backend.mjs so
// they can be unit-tested without the module binding a port on import — the
// same reason backend-buffers.mjs and backend-lifecycle.mjs live outside it.
import { channel } from "node:diagnostics_channel";

import { PayloadTooLargeError } from "./backend-buffers.mjs";

/**
 * #230: raw errors are published here instead of logged. A subscriber attached
 * in-process sees the original error object; nothing is printed or persisted by
 * default, so this adds no clear-text-logging sink — a plain
 * `console.error(error)` would have opened a fifth js/clear-text-logging alert
 * while closing the stack-trace-exposure one.
 *
 * Nothing subscribes yet. This is the seam #145 (no logging, diagnostics, or
 * crash reporting in the app) is meant to attach to, not a working diagnostic
 * on its own.
 */
export const HTTP_ERROR_DIAGNOSTIC_CHANNEL = "termsnip.backend.http-error";
const httpErrorDiagnostics = channel(HTTP_ERROR_DIAGNOSTIC_CHANNEL);

export function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(body));
}

/**
 * Single response shape for every catch-block in the HTTP handlers. Audit
 * pickup: the pattern
 *   sendJson(response, 500, { error: getErrorMessage(error) })
 * was duplicated 16 times in backend.mjs, which made the contract implicit and
 * brittle (e.g. one site forgot the `error` key, would be hard to notice). Use
 * this helper instead.
 *
 * #230: the status still comes from the error where it carries one, but the
 * MESSAGE is never taken from the error. Client text is rebuilt from trusted
 * data only.
 *
 * Deny-by-default rather than "relay app-thrown messages, scrub library-thrown
 * ones", because that split does not survive this codebase: globSshConfigFiles
 * throws `glob directory ${parentReal} is not under ${sshRoot}` from
 * application code and interpolates two absolute paths. Where an error came
 * from is not a safety signal — and this function receives only an error and a
 * default status, so it could not decide provenance even if it were.
 */
export function respondError(response, error, status = 500) {
  // Honor a status the error carries (e.g. PayloadTooLargeError => 413) so
  // readJson's body-cap rejection surfaces as the right HTTP status.
  const statusCode = error?.statusCode ?? status;

  if (httpErrorDiagnostics.hasSubscribers) {
    httpErrorDiagnostics.publish({ error, statusCode });
  }

  let message =
    Number.isInteger(statusCode) && statusCode >= 400 && statusCode < 500
      ? "Invalid request."
      : "Internal server error.";

  // The one exception: a size limit is a number this process chose, not
  // anything the error text carried, and a user hitting an upload cap needs it.
  if (
    statusCode === 413 &&
    error instanceof PayloadTooLargeError &&
    Number.isSafeInteger(error.limit) &&
    error.limit > 0
  ) {
    message = `Request body exceeds the ${error.limit}-byte limit.`;
  }

  sendJson(response, statusCode, { error: message });
}
