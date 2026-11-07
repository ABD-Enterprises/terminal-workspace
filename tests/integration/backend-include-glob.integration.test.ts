import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// #486: the real browser backend, with HOME pointed at a throwaway directory,
// so its ~/.ssh is one this test builds.

const TOKEN = "t".repeat(48);
const CAP = 256;
let backend: ChildProcess;
let baseUrl = "";
let home = "";

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
  home = mkdtempSync(join(tmpdir(), "tw-include-glob-"));
  const ordered = join(home, ".ssh", "ordered");
  const many = join(home, ".ssh", "many");
  mkdirSync(ordered, { recursive: true });
  mkdirSync(many, { recursive: true });
  for (const name of ["alpha.conf", "_x.conf", "Zebra.conf", "Beta.conf", "2.conf", "10.conf"]) {
    writeFileSync(join(ordered, name), `# ${name}\n`);
  }
  for (let index = CAP + 20 - 1; index >= 0; index -= 1) {
    writeFileSync(join(many, `${String(index).padStart(4, "0")}.conf`), "Host x\n");
  }

  const port = await freePort();
  baseUrl = `http://127.0.0.1:${port}`;
  backend = spawn(process.execPath, ["apps/desktop/server/backend.mjs"], {
    env: {
      ...process.env,
      HOME: home,
      TERMSNIP_BACKEND_PORT: String(port),
      TERMSNIP_BACKEND_TOKEN: TOKEN,
      TERMSNIP_STATE_DIR: join(home, "state"),
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
  rmSync(home, { recursive: true, force: true });
});

async function glob(pattern: string) {
  const response = await fetch(`${baseUrl}/api/backend/ssh-config/glob`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Termsnip-Token": TOKEN },
    body: JSON.stringify({ pattern }),
  });
  expect(response.status).toBe(200);
  return (await response.json()) as {
    matches: { name: string }[];
    truncated: boolean;
  };
}

describe("#486: browser backend Include globs", () => {
  it("returns matches in byte order", async () => {
    const result = await glob("~/.ssh/ordered/*.conf");
    expect(result.matches.map((match) => match.name)).toEqual([
      "10.conf",
      "2.conf",
      "Beta.conf",
      "Zebra.conf",
      "_x.conf",
      "alpha.conf",
    ]);
    expect(result.truncated).toBe(false);
  });

  it("over the cap, keeps the first files in byte order and says so", async () => {
    const result = await glob("~/.ssh/many/*.conf");
    expect(result.truncated).toBe(true);
    expect(result.matches).toHaveLength(CAP);
    expect(result.matches.map((match) => match.name)).toEqual(
      Array.from({ length: CAP }, (_, index) => `${String(index).padStart(4, "0")}.conf`)
    );
  });
});
