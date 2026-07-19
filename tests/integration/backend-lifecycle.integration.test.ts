import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

// The backend lifecycle helpers are plain ESM shipped with the Node backend;
// load via dynamic import so the test needs no build step (and, unlike
// backend.mjs, this module does not bind a port on import).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let lifecycle: any;
async function loadLifecycle() {
  if (!lifecycle) {
    lifecycle = await import("../../apps/desktop/server/backend-lifecycle.mjs");
  }
  return lifecycle;
}

describe("backend lifecycle", () => {
  const tmpDirs: string[] = [];
  afterEach(() => {
    for (const dir of tmpDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("describeServerListenError returns a friendly message for EADDRINUSE and null otherwise", async () => {
    const { describeServerListenError } = await loadLifecycle();
    const message = describeServerListenError({ code: "EADDRINUSE" }, 8790);
    expect(message).toContain("8790");
    expect(message).toContain("already in use");
    expect(describeServerListenError({ code: "ECONNREFUSED" }, 8790)).toBeNull();
    expect(describeServerListenError(null, 8790)).toBeNull();
  });

  it("shutdownBackend closes every session and forward, both servers, and unlinks the sidecar", async () => {
    const { shutdownBackend } = await loadLifecycle();

    const dir = mkdtempSync(join(tmpdir(), "backend-lifecycle-"));
    tmpDirs.push(dir);
    const sidecarPath = join(dir, "token");
    writeFileSync(sidecarPath, "secret\n");

    const clientEnd = vi.fn();
    const jumpEnd = vi.fn();
    const wsClose = vi.fn();
    const streamClose = vi.fn();
    const sessions = new Map([
      [
        "s1",
        {
          client: { end: clientEnd },
          jumpClient: { end: jumpEnd },
          ws: { close: wsClose },
          stream: { close: streamClose },
        },
      ],
    ]);
    const forwardClose = vi.fn();
    const forwards = new Map([["f1", { server: { close: forwardClose } }]]);
    const serverClose = vi.fn();
    const wsServerClose = vi.fn();

    shutdownBackend({
      server: { close: serverClose },
      websocketServer: { close: wsServerClose },
      sessions,
      forwards,
      sidecarPath,
    });

    expect(clientEnd).toHaveBeenCalled();
    expect(jumpEnd).toHaveBeenCalled();
    expect(wsClose).toHaveBeenCalled();
    expect(streamClose).toHaveBeenCalled();
    expect(forwardClose).toHaveBeenCalled();
    expect(serverClose).toHaveBeenCalled();
    expect(wsServerClose).toHaveBeenCalled();
    expect(sessions.size).toBe(0);
    expect(forwards.size).toBe(0);
    expect(existsSync(sidecarPath)).toBe(false);
  });

  it("shutdownBackend never throws even when a close step fails or fields are missing", async () => {
    const { shutdownBackend } = await loadLifecycle();
    const sessions = new Map([
      [
        "s1",
        {
          client: {
            end: () => {
              throw new Error("boom");
            },
          },
        },
      ],
    ]);
    expect(() =>
      shutdownBackend({
        server: null,
        websocketServer: null,
        sessions,
        forwards: new Map(),
        sidecarPath: "/definitely/not/a/real/path/token",
      })
    ).not.toThrow();
    expect(sessions.size).toBe(0);
  });
});
