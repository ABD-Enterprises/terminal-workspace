import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vitest";

// #474: the real backend, started with no TERMSNIP_BACKEND_TOKEN, as a
// developer would run it. Every other backend fixture supplies a token from
// the environment, so this is the only test that exercises the generated path.

const stateDir = mkdtempSync(join(tmpdir(), "tw-token-startup-"));
let backend: ChildProcess | undefined;

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

async function start(port: number) {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    TERMSNIP_BACKEND_PORT: String(port),
    TERMSNIP_STATE_DIR: stateDir,
  };
  delete env.TERMSNIP_BACKEND_TOKEN;
  const child = spawn(process.execPath, ["apps/desktop/server/backend.mjs"], {
    env,
    stdio: "ignore",
  });
  const deadline = Date.now() + 15_000;
  for (;;) {
    try {
      await fetch(`http://127.0.0.1:${port}/api/backend/status`);
      return child;
    } catch {
      if (Date.now() > deadline) {
        child.kill("SIGKILL");
        throw new Error("backend did not start");
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}

async function stop(child: ChildProcess) {
  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.kill("SIGTERM");
  await exited;
}

function status(port: number, token: string) {
  return fetch(`http://127.0.0.1:${port}/api/backend/status`, {
    headers: { "X-Termsnip-Token": token },
  });
}

afterEach(async () => {
  if (backend && backend.exitCode === null) {
    await stop(backend);
  }
  backend = undefined;
});

afterAll(() => {
  rmSync(stateDir, { recursive: true, force: true });
});

describe("backend started with no token in the environment (#474)", () => {
  it("writes a private token file that authenticates, removes it on shutdown, and never reuses it", async () => {
    const port = await freePort();
    const file = join(stateDir, "backend", `backend.${port}.token`);

    backend = await start(port);
    expect(existsSync(file)).toBe(true);
    if (process.platform !== "win32") {
      expect(statSync(file).mode & 0o777).toBe(0o600);
    }
    const first = readFileSync(file, "utf8").trim();
    expect((await status(port, first)).status).toBe(200);
    expect((await status(port, "x".repeat(64))).status).toBe(403);

    await stop(backend);
    expect(existsSync(file)).toBe(false);

    backend = await start(port);
    const second = readFileSync(file, "utf8").trim();
    expect(second).not.toBe(first);
    expect((await status(port, first)).status).toBe(403);
    expect((await status(port, second)).status).toBe(200);
  }, 60_000);

  it("a second launch on the same port fails without touching the running backend's file", async () => {
    const port = await freePort();
    const file = join(stateDir, "backend", `backend.${port}.token`);
    backend = await start(port);
    const running = readFileSync(file, "utf8").trim();

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      TERMSNIP_BACKEND_PORT: String(port),
      TERMSNIP_STATE_DIR: stateDir,
    };
    delete env.TERMSNIP_BACKEND_TOKEN;
    const second = spawn(process.execPath, ["apps/desktop/server/backend.mjs"], {
      env,
      stdio: "ignore",
    });
    const exitCode = await new Promise((resolve) => second.once("exit", resolve));
    expect(exitCode).toBe(1);

    expect(readFileSync(file, "utf8").trim()).toBe(running);
    expect((await status(port, running)).status).toBe(200);
  }, 60_000);
});
