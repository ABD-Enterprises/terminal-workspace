import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  PRIVATE_KEY_EXISTS_MESSAGE,
  readBoundedRegularFile,
  writeNewPrivateFile,
} from "../../apps/desktop/server/backend-files.mjs";

// CodeQL js/file-system-race (alerts 32/33): backend.mjs checked a path with
// stat() and then wrote or read it by name, so the file acted on could differ
// from the file checked. These helpers establish the property on the same
// descriptor instead.

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "backend-files-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("writeNewPrivateFile", () => {
  it("creates the file with mode 0600", async () => {
    const path = join(dir, "id_ed25519");
    await writeNewPrivateFile(path, "KEY\n");

    expect(await readFile(path, "utf8")).toBe("KEY\n");
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  });

  it("refuses an existing file and leaves its contents untouched", async () => {
    const path = join(dir, "id_ed25519");
    await writeFile(path, "ORIGINAL", { mode: 0o600 });

    await expect(writeNewPrivateFile(path, "REPLACEMENT")).rejects.toThrow(
      PRIVATE_KEY_EXISTS_MESSAGE
    );
    expect(await readFile(path, "utf8")).toBe("ORIGINAL");
  });

  it("lets exactly one of two concurrent creates win", async () => {
    // The stat()-then-write version let both callers pass the check and the
    // second silently overwrite the first.
    const path = join(dir, "id_ed25519");
    const results = await Promise.allSettled([
      writeNewPrivateFile(path, "FIRST"),
      writeNewPrivateFile(path, "SECOND"),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const winner = results[0].status === "fulfilled" ? "FIRST" : "SECOND";
    expect(await readFile(path, "utf8")).toBe(winner);
  });

  it("does not follow a dangling symlink to create its target", async () => {
    const target = join(dir, "elsewhere");
    const link = join(dir, "id_ed25519");
    await symlink(target, link);

    await expect(writeNewPrivateFile(link, "KEY")).rejects.toThrow(PRIVATE_KEY_EXISTS_MESSAGE);
    await expect(stat(target)).rejects.toMatchObject({ code: "ENOENT" });
  });
});

describe("readBoundedRegularFile", () => {
  it("reads a regular file within the limit", async () => {
    const path = join(dir, "config");
    await writeFile(path, "Host *\n");

    expect(await readBoundedRegularFile(path, 1024)).toBe("Host *\n");
  });

  it("returns undefined for a file over the limit", async () => {
    const path = join(dir, "config");
    await writeFile(path, "x".repeat(11));

    expect(await readBoundedRegularFile(path, 10)).toBeUndefined();
  });

  it("returns undefined for a directory and a missing path", async () => {
    expect(await readBoundedRegularFile(dir, 1024)).toBeUndefined();
    expect(await readBoundedRegularFile(join(dir, "missing"), 1024)).toBeUndefined();
  });

  it("returns undefined for a FIFO instead of blocking on it", async () => {
    // A plain O_RDONLY open() of a FIFO with no writer blocks forever; the
    // old stat() pre-check is what used to keep a FIFO in ~/.ssh from hanging.
    const fifo = join(dir, "fifo");
    execFileSync("mkfifo", [fifo]);

    expect(await readBoundedRegularFile(fifo, 1024)).toBeUndefined();
  });
});
