import { createServer, request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let buffers: any;
async function load() {
  if (!buffers) {
    buffers = await import("../../apps/desktop/server/backend-buffers.mjs");
  }
  return buffers;
}

function postForStatus(port: number, body: Buffer): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { host: "127.0.0.1", port, method: "POST", path: "/" },
      (res) => {
        res.resume(); // drain the response body
        resolve(res.statusCode ?? 0);
      }
    );
    req.on("error", reject);
    req.end(body);
  });
}

describe("backend memory bounds", () => {
  it("readJson returns a real HTTP 413 for an oversize body (not a socket reset)", async () => {
    const { readJson } = await load();
    // A real server so we exercise the actual IncomingMessage — an
    // async-generator mock would hide the socket-destruction gotcha.
    const server = createServer(async (req, res) => {
      try {
        const body = await readJson(req, 1024); // 1 KiB cap
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(body));
      } catch (error: unknown) {
        const status = (error as { statusCode?: number })?.statusCode ?? 500;
        res.writeHead(status);
        res.end(String((error as Error)?.message ?? error));
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;

    try {
      // 4 KiB body against a 1 KiB cap: the client must RECEIVE a 413, proving
      // the connection was not destroyed before the response was sent.
      expect(await postForStatus(port, Buffer.alloc(4096, 0x61))).toBe(413);
      // A within-limit JSON body still succeeds.
      expect(await postForStatus(port, Buffer.from(JSON.stringify({ ok: true })))).toBe(200);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("bufferDetachedOutput drops the oldest chunks and records dropped bytes past the cap", async () => {
    const { bufferDetachedOutput } = await load();
    const session = { buffer: [] as string[], bufferBytes: 0, droppedBytes: 0 };
    // cap = 10 bytes; 4 + 4 + 4 = 12 > 10 => the first "aaaa" is evicted.
    bufferDetachedOutput(session, "aaaa", 10);
    bufferDetachedOutput(session, "bbbb", 10);
    bufferDetachedOutput(session, "cccc", 10);
    expect(session.buffer.join("")).toBe("bbbbcccc");
    expect(session.bufferBytes).toBe(8);
    expect(session.droppedBytes).toBe(4);
  });

  it("bufferDetachedOutput keeps everything while under the cap", async () => {
    const { bufferDetachedOutput } = await load();
    const session = { buffer: [] as string[], bufferBytes: 0, droppedBytes: 0 };
    bufferDetachedOutput(session, "hi", 100);
    bufferDetachedOutput(session, "there", 100);
    expect(session.buffer.join("")).toBe("hithere");
    expect(session.bufferBytes).toBe(7);
    expect(session.droppedBytes).toBe(0);
  });

  it("bufferDetachedOutput keeps a single chunk larger than the cap rather than losing everything", async () => {
    const { bufferDetachedOutput } = await load();
    const session = { buffer: [] as string[], bufferBytes: 0, droppedBytes: 0 };
    bufferDetachedOutput(session, "0123456789ABCDEF", 8); // 16 bytes, cap 8
    expect(session.buffer.join("")).toBe("0123456789ABCDEF");
    expect(session.droppedBytes).toBe(0);
  });
});
