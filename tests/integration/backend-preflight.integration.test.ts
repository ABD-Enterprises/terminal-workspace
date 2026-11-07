import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { isJsonContentType } from "../../apps/desktop/server/backend-buffers.mjs";

// #470: an allowed Origin must not be enough for a web page to drive the
// backend. These run against the real backend process, because the protection
// depends on where the checks sit in its request handler.

const ALLOWED_ORIGIN = "http://127.0.0.1:5173";
// A route with its own error handling, so a 415 here proves the central check
// ran first rather than the route mapping a parse failure to some status.
const ROUTE = "/api/backend/ssh-config/glob";

let backend: ChildProcess;
let baseUrl = "";
let stateDir = "";

async function freePort() {
  return new Promise<number>((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

beforeAll(async () => {
  const port = await freePort();
  baseUrl = `http://127.0.0.1:${port}`;
  stateDir = mkdtempSync(join(tmpdir(), "tw-preflight-"));
  backend = spawn(process.execPath, ["apps/desktop/server/backend.mjs"], {
    env: {
      ...process.env,
      TERMSNIP_BACKEND_PORT: String(port),
      TERMSNIP_BACKEND_TOKEN: "t".repeat(48),
      TERMSNIP_ALLOWED_ORIGINS: ALLOWED_ORIGIN,
      TERMSNIP_STATE_DIR: stateDir,
    },
    stdio: "ignore",
  });

  const deadline = Date.now() + 15_000;
  for (;;) {
    try {
      await fetch(`${baseUrl}/api/backend/status`);
      break;
    } catch {
      if (Date.now() > deadline) {
        throw new Error("backend did not start");
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}, 30_000);

afterAll(() => {
  backend?.kill("SIGTERM");
  rmSync(stateDir, { recursive: true, force: true });
});

function post(contentType: string | undefined, origin = ALLOWED_ORIGIN) {
  const headers: Record<string, string> = { Origin: origin };
  if (contentType) {
    headers["Content-Type"] = contentType;
  }
  // A Uint8Array body stops fetch adding a default content type of its own.
  return fetch(`${baseUrl}${ROUTE}`, {
    method: "POST",
    headers,
    body: new TextEncoder().encode("{}"),
  });
}

describe("#470: POST needs a JSON content type even with an allowed Origin", () => {
  it.each([
    ["text/plain"],
    ["text/plain;charset=UTF-8"],
    ["application/x-www-form-urlencoded"],
    ["multipart/form-data; boundary=x"],
    ["text/plain; application/json"],
  ])("refuses %s with 415", async (contentType) => {
    const response = await post(contentType);
    expect(response.status).toBe(415);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("refuses a request with no content type", async () => {
    const response = await post(undefined);
    expect(response.status).toBe(415);
  });

  it("still checks credentials first", async () => {
    const response = await post("text/plain", "http://evil.example");
    expect(response.status).toBe(403);
  });

  it.each([["application/json"], ["application/json; charset=utf-8"], ["Application/JSON"]])(
    "lets %s reach the route",
    async (contentType) => {
      const response = await post(contentType);
      expect(response.status).not.toBe(415);
      expect(response.status).not.toBe(403);
    }
  );
});

describe("#470: preflight always fails", () => {
  it.each([[ALLOWED_ORIGIN], ["http://evil.example"]])(
    "answers OPTIONS from %s with 405 and no CORS headers",
    async (origin) => {
      const response = await fetch(`${baseUrl}${ROUTE}`, {
        method: "OPTIONS",
        headers: {
          Origin: origin,
          "Access-Control-Request-Method": "POST",
          "Access-Control-Request-Headers": "content-type",
        },
      });
      expect(response.status).toBe(405);
      const corsHeaders = [...response.headers.keys()].filter((name) =>
        name.startsWith("access-control-")
      );
      expect(corsHeaders).toEqual([]);
    }
  );
});

describe("isJsonContentType", () => {
  it("matches only the exact media type", () => {
    expect(isJsonContentType("application/json")).toBe(true);
    expect(isJsonContentType("application/json;")).toBe(true);
    expect(isJsonContentType(" APPLICATION/JSON ; charset=utf-8")).toBe(true);
    expect(isJsonContentType("application/jsonp")).toBe(false);
    expect(isJsonContentType("application/json, text/plain")).toBe(false);
    expect(isJsonContentType("text/plain; application/json")).toBe(false);
    expect(isJsonContentType("")).toBe(false);
    expect(isJsonContentType(undefined)).toBe(false);
  });
});
