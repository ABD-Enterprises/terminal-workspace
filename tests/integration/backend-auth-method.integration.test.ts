import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// #473: the backend accepts only the SSH sign-in methods it supports, and
// forwards the SSH agent only for requests that present the token. These
// run against the real backend process. The target port has nothing listening:
// a request that got past the check would try to connect and fail with a
// server error, so a 400 shows the check refused it before any connection.

const ORIGIN = "http://127.0.0.1:5173";
const TOKEN = "t".repeat(48);

let backend: ChildProcess;
let baseUrl = "";
let stateDir = "";
let closedPort = 0;

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
  closedPort = await freePort();
  baseUrl = `http://127.0.0.1:${port}`;
  stateDir = mkdtempSync(join(tmpdir(), "tw-auth-method-"));
  backend = spawn(process.execPath, ["apps/desktop/server/backend.mjs"], {
    env: {
      ...process.env,
      TERMSNIP_BACKEND_PORT: String(port),
      TERMSNIP_BACKEND_TOKEN: TOKEN,
      TERMSNIP_ALLOWED_ORIGINS: ORIGIN,
      TERMSNIP_STATE_DIR: stateDir,
      TERMSNIP_ALLOW_AGENT_FORWARDING: "1",
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

function host(authMethod: unknown, extra: Record<string, unknown> = {}) {
  return {
    hostname: "127.0.0.1",
    port: closedPort,
    username: "ops",
    authMethod,
    hostKeyPolicy: "allowUnknown",
    ...extra,
  };
}

function post(path: string, body: unknown, { withToken = true } = {}) {
  const headers: Record<string, string> = { Origin: ORIGIN, "Content-Type": "application/json" };
  if (withToken) {
    headers.Authorization = `Bearer ${TOKEN}`;
  }
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

describe("#473: only supported SSH sign-in methods reach a connection", () => {
  it.each([["agent"], ["keyboard-interactive"], [""], [undefined], [42]])(
    "refuses a session with sign-in method %s",
    async (authMethod) => {
      const response = await post("/api/backend/sessions", { host: host(authMethod) });
      expect(response.status).toBe(400);
    }
  );

  it("refuses a file listing with an unsupported sign-in method", async () => {
    const response = await post("/api/backend/sftp/list", { host: host("agent"), path: "/" });
    expect(response.status).toBe(400);
  });

  it("refuses an unsupported sign-in method on a jump hop", async () => {
    const response = await post("/api/backend/sftp/list", {
      host: host("password", { password: "pw", jumpHost: host("agent") }),
      path: "/",
    });
    expect(response.status).toBe(400);
  });

  it("refuses agent forwarding for a request authorized only by its Origin", async () => {
    const forwarding = host("password", { password: "pw", agentForwarding: true });
    const response = await post(
      "/api/backend/sftp/list",
      { host: forwarding, path: "/" },
      { withToken: false }
    );
    expect(response.status).toBe(403);
    // The user is told what to change, not just "Invalid request."
    expect(((await response.json()) as { error: string }).error).toMatch(/Turn off agent forwarding/);

    const session = await post("/api/backend/sessions", { host: forwarding }, { withToken: false });
    expect(session.status).toBe(403);
  });

  it("lets a supported sign-in method through to the connection attempt", async () => {
    // Control: the same request with a password gets past the check and fails
    // only because nothing is listening, so the refusals above are the check.
    const response = await post("/api/backend/sftp/list", {
      host: host("password", { password: "pw" }),
      path: "/",
    });
    expect(response.status).not.toBe(400);

    // With operator approval and the token, forwarding gets past the checks.
    const forwarding = await post("/api/backend/sftp/list", {
      host: host("password", { password: "pw", agentForwarding: true }),
      path: "/",
    });
    expect([400, 403]).not.toContain(forwarding.status);
  });
});
