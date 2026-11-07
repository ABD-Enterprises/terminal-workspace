import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { BackendProbeError, probeBackendStatus } from "../../apps/desktop/src/lib/backend-runtime";

// #502: the preview banner's startup probe must get past the REAL auth gate in
// apps/desktop/server/backend.mjs. A browser sends an Origin header on a
// same-origin POST but not on a same-origin GET, so the probe has to be a POST.
// These tests start the actual backend on a spare port and make requests the
// way a browser page served from the allowed dev origin would.

const ALLOWED_ORIGIN = "http://127.0.0.1:5173";
const realFetch = globalThis.fetch;

let backend: ChildProcess;
let baseUrl = "";

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
  backend = spawn(process.execPath, ["apps/desktop/server/backend.mjs"], {
    env: {
      ...process.env,
      TERMSNIP_BACKEND_PORT: String(port),
      TERMSNIP_BACKEND_TOKEN: "t".repeat(48),
      TERMSNIP_ALLOWED_ORIGINS: ALLOWED_ORIGIN,
    },
    stdio: "ignore",
  });

  const deadline = Date.now() + 15_000;
  for (;;) {
    try {
      await realFetch(`${baseUrl}/api/backend/status`);
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
  vi.unstubAllGlobals();
});

// Mimics a browser page on ALLOWED_ORIGIN: relative URLs resolve to the
// backend, and Origin is added for every method except GET and HEAD.
function browserFetch(origin: string | undefined) {
  return (input: RequestInfo | URL, init?: RequestInit) => {
    const method = (init?.method ?? "GET").toUpperCase();
    const headers = new Headers(init?.headers);
    if (origin && method !== "GET" && method !== "HEAD") {
      headers.set("Origin", origin);
    }
    return realFetch(`${baseUrl}${String(input)}`, { ...init, headers });
  };
}

describe("backend status probe against the real auth gate", () => {
  it("documents that a same-origin GET carries no Origin and is refused", async () => {
    const response = await browserFetch(ALLOWED_ORIGIN)("/api/backend/status");
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Unauthorized", reason: "no-credentials" });
  });

  it("succeeds from an allowed origin", async () => {
    vi.stubGlobal("fetch", browserFetch(ALLOWED_ORIGIN));
    await expect(probeBackendStatus()).resolves.toEqual({ ok: true });
  });

  it("reports an origin the backend does not allow as unauthorized, not unreachable", async () => {
    vi.stubGlobal("fetch", browserFetch("http://evil.example"));
    await expect(probeBackendStatus()).rejects.toMatchObject({
      name: "BackendProbeError",
      kind: "unauthorized",
      status: 403,
    });
  });

  it("reports a closed port as unreachable", async () => {
    const port = await freePort();
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) =>
      realFetch(`http://127.0.0.1:${port}${String(input)}`, init)
    );
    const error = await probeBackendStatus().catch((caught) => caught);
    expect(error).toBeInstanceOf(BackendProbeError);
    expect(error.kind).toBe("unreachable");
  });
});
