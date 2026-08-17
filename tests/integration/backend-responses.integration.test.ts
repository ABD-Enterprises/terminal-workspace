import { subscribe, unsubscribe } from "node:diagnostics_channel";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import { PayloadTooLargeError } from "../../apps/desktop/server/backend-buffers.mjs";
import {
  HTTP_ERROR_DIAGNOSTIC_CHANNEL,
  respondError,
} from "../../apps/desktop/server/backend-responses.mjs";

// #230 / CodeQL alert 18 (js/stack-trace-exposure). `respondError` used to
// serialize `Error.message` straight into the HTTP body, so raw ssh2 and fs
// text — which routinely carries absolute filesystem paths — reached the
// client. These tests pin the replacement contract: the STATUS still comes from
// the error where it carries one, the MESSAGE never does.
//
// They import from backend-responses.mjs rather than backend.mjs because
// importing backend.mjs binds a port.

/** Minimal ServerResponse stand-in — records what actually went on the wire. */
function recordingResponse() {
  const recorded: { status?: number; headers?: unknown; body?: string } = {};
  return {
    recorded,
    writeHead(status: number, headers: unknown) {
      recorded.status = status;
      recorded.headers = headers;
    },
    end(body: string) {
      recorded.body = body;
    },
  };
}

describe("#230: respondError does not relay internal error text", () => {
  it("keeps a sentinel from an internal Error.message out of the response body", () => {
    // If this string ever appears in a body again, the leak is back.
    const sentinel = "TS_RESPOND_ERROR_PROBE_4f81ac0e935d";
    const response = recordingResponse();

    respondError(response, new Error(`connect ECONNREFUSED ${sentinel}`));

    expect(response.recorded.body).toBeDefined();
    expect(response.recorded.body).not.toContain(sentinel);
  });

  it("returns a non-revealing 500 for a generic internal error", () => {
    const response = recordingResponse();

    respondError(response, new Error("EACCES: permission denied, open '/Users/someone/.ssh/id_ed25519'"));

    expect(response.recorded.status).toBe(500);
    expect(JSON.parse(response.recorded.body!)).toEqual({ error: "Internal server error." });
  });

  it("keeps the glob endpoint's refusal a 400, without the paths it names", () => {
    // The literal shape globSshConfigFiles throws. It is application-authored
    // and still leaks two absolute paths, which is why provenance is not used
    // as a safety signal.
    const response = recordingResponse();
    const error = new Error(
      "glob directory /Users/someone/.ssh/conf.d is not under /Users/someone/.ssh"
    );

    respondError(response, error, 400);

    expect(response.recorded.status).toBe(400);
    expect(JSON.parse(response.recorded.body!)).toEqual({ error: "Invalid request." });
    expect(response.recorded.body).not.toContain("/Users/someone");
  });

  it("still tells a 413 caller what the byte limit was", () => {
    const response = recordingResponse();

    respondError(response, new PayloadTooLargeError(64 * 1024 * 1024));

    expect(response.recorded.status).toBe(413);
    expect(JSON.parse(response.recorded.body!).error).toContain("67108864");
  });

  it("does not mistake a look-alike for a PayloadTooLargeError", () => {
    // A plain error carrying statusCode 413 gets the status but not the
    // reconstructed message — the limit has to come from the typed error.
    const response = recordingResponse();
    const impostor = Object.assign(new Error("nice try /etc/passwd"), {
      statusCode: 413,
      limit: 42,
    });

    respondError(response, impostor);

    expect(response.recorded.status).toBe(413);
    expect(JSON.parse(response.recorded.body!)).toEqual({ error: "Invalid request." });
  });

  it("publishes the raw error server-side while withholding it from the client", () => {
    const sentinel = "TS_DIAGNOSTIC_PROBE_7c02be14a6f9";
    const seen: Array<{ error?: Error; statusCode?: number }> = [];
    const onError = (message: unknown) => {
      seen.push(message as { error?: Error; statusCode?: number });
    };

    subscribe(HTTP_ERROR_DIAGNOSTIC_CHANNEL, onError);
    try {
      const response = recordingResponse();
      respondError(response, new Error(sentinel), 400);

      expect(seen).toHaveLength(1);
      expect(seen[0]?.error?.message).toBe(sentinel);
      expect(seen[0]?.statusCode).toBe(400);
      expect(response.recorded.body).not.toContain(sentinel);
    } finally {
      unsubscribe(HTTP_ERROR_DIAGNOSTIC_CHANNEL, onError);
    }
  });
});

describe("#230: the surrounding contract is unchanged", () => {
  it("leaves the WebSocket failSession diagnostics carrying the real message", async () => {
    // Sanitizing getErrorMessage would have been the easy fix and would have
    // blinded the terminal error surface. Source-contract test because
    // importing backend.mjs binds a port.
    const source = await readFile("apps/desktop/server/backend.mjs", "utf8");

    expect(source).toContain("function getErrorMessage(error) {\n  return error instanceof Error ? error.message : String(error);\n}");
    expect(source).toMatch(/function failSession\(session, error\) \{[\s\S]*?message: getErrorMessage\(error\),/);
  });

  it("still routes the glob endpoint's refusal through an explicit 400", async () => {
    const source = await readFile("apps/desktop/server/backend.mjs", "utf8");

    expect(source).toContain("respondError(response, error, 400);");
  });

  it("no longer defines respondError locally in backend.mjs", async () => {
    const source = await readFile("apps/desktop/server/backend.mjs", "utf8");

    expect(source).toContain('from "./backend-responses.mjs"');
    expect(source).not.toMatch(/^function respondError\(/m);
    expect(source).not.toMatch(/^function sendJson\(/m);
  });
});
