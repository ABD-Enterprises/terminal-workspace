// SEC-2: the Node backend must verify SSH host keys, not accept whatever
// answers the socket.
//
// The defect this covers: the backend installed ssh2's `hostVerifier` only when
// the caller already supplied a known host key. With none supplied, ssh2 took
// its default branch and accepted the presented key without checking it — and
// nothing was recorded, so the host stayed unverifiable on every connect. In
// browser mode that made every host whose policy is not `requireTrusted`
// MITM-able.
//
// These tests drive the store directly, against a real filesystem in a
// temporary directory, so they cover the durable behaviour rather than a mock:
// a pin written by one store instance is read by the next.

import { existsSync as existsSyncSync } from "node:fs";
import { mkdtemp, readFile, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let module: any;
async function load() {
  if (!module) {
    module = await import("../../apps/desktop/server/backend-host-keys.mjs");
  }
  return module;
}

/**
 * A stand-in for an SSH public key blob.
 *
 * The real blob begins with the algorithm name as a length-prefixed string,
 * which is exactly what the store reads. The trailing bytes stand in for the
 * key material.
 */
function existsSyncStore(path: string): boolean {
  return existsSyncSync(path);
}

function keyBlob(algorithm = "ssh-ed25519", filler = "AAAA"): Buffer {
  const name = Buffer.from(algorithm, "utf8");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(name.length, 0);
  return Buffer.concat([length, name, Buffer.from(filler, "utf8")]);
}

describe("backend SSH host-key trust", () => {
  let root = "";
  let storePath = "";

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "termsnip-host-keys-"));
    storePath = join(root, "ssh", "known_hosts");
  });

  afterEach(async () => {
    const { rm } = await import("node:fs/promises");
    await rm(root, { recursive: true, force: true });
  });

  describe("host patterns", () => {
    it("writes port 22 bare and other ports bracketed", async () => {
      const { knownHostsHostPattern } = await load();
      expect(knownHostsHostPattern("example.internal", 22)).toBe("example.internal");
      expect(knownHostsHostPattern("example.internal", 2222)).toBe("[example.internal]:2222");
    });

    it("refuses a host with no name or an impossible port", async () => {
      const { knownHostsHostPattern } = await load();
      expect(() => knownHostsHostPattern("", 22)).toThrow();
      expect(() => knownHostsHostPattern("example.internal", 0)).toThrow();
      expect(() => knownHostsHostPattern("example.internal", 70000)).toThrow();
    });

    it("refuses a hostname that could forge another record", async () => {
      // The store is a line-oriented file: one record per line, fields split
      // on whitespace, and a line starting with "#" is a comment. A hostname
      // carrying a newline could therefore write a record for a different
      // host — forging a pin — or a malformed line that breaks the store for
      // every host. The store is shared with the native app, so a record
      // written here is trust the native app reads too.
      const { knownHostsHostPattern } = await load();
      expect(() => knownHostsHostPattern("a.internal\nb.internal", 22)).toThrow();
      expect(() => knownHostsHostPattern("#\ntrusted.internal", 22)).toThrow();
      expect(() => knownHostsHostPattern("a.internal b.internal", 22)).toThrow();
      expect(() => knownHostsHostPattern("trusted.internal#", 22)).toThrow();
    });
  });

  describe("algorithm names", () => {
    it("reads the algorithm from the key blob", async () => {
      const { hostKeyAlgorithmName } = await load();
      expect(hostKeyAlgorithmName(keyBlob("ssh-ed25519"))).toBe("ssh-ed25519");
      expect(hostKeyAlgorithmName(keyBlob("ecdsa-sha2-nistp256"))).toBe("ecdsa-sha2-nistp256");
      expect(hostKeyAlgorithmName(keyBlob("ssh-rsa"))).toBe("ssh-rsa");
    });

    it("refuses a blob it cannot read rather than writing it ambiguously", async () => {
      const { hostKeyAlgorithmName } = await load();
      expect(hostKeyAlgorithmName(Buffer.alloc(0))).toBeNull();
      expect(hostKeyAlgorithmName(Buffer.from([0, 0]))).toBeNull();
      // A length prefix that runs past the end of the blob.
      expect(hostKeyAlgorithmName(Buffer.from([0, 0, 0, 99, 1, 2]))).toBeNull();
      // A zero-length name.
      expect(hostKeyAlgorithmName(Buffer.from([0, 0, 0, 0, 1, 2]))).toBeNull();
    });
  });

  describe("store location", () => {
    it("honours the state-directory override", async () => {
      const { resolveKnownHostsPath, resolveAppDataDirectory } = await load();
      expect(resolveAppDataDirectory({ TERMSNIP_STATE_DIR: "/tmp/somewhere" })).toBe(
        "/tmp/somewhere",
      );
      expect(resolveKnownHostsPath({ TERMSNIP_STATE_DIR: "/tmp/somewhere" })).toBe(
        join("/tmp/somewhere", "ssh", "known_hosts"),
      );
    });

    it("falls back to the bundle identifier under the platform data directory", async () => {
      const { resolveAppDataDirectory } = await load();
      const resolved = resolveAppDataDirectory({});
      expect(resolved).toContain("com.abdenterprises.terminalworkspace");
    });
  });

  describe("trust on first use", () => {
    it("pins the first key it sees and records it in the OpenSSH record shape", async () => {
      const { createHostKeyStore, HOST_KEY_VERDICT } = await load();
      const store = createHostKeyStore({ path: storePath });

      const result = await store.verifyOrPin({
        hostname: "example.internal",
        port: 2222,
        keyBlob: keyBlob(),
      });

      expect(result.verdict).toBe(HOST_KEY_VERDICT.PINNED);

      const contents = await readFile(storePath, "utf8");
      expect(contents).toBe(
        `[example.internal]:2222 ssh-ed25519 ${keyBlob().toString("base64")}\n`,
      );
    });

    it("matches the pinned key on a later connection", async () => {
      const { createHostKeyStore, HOST_KEY_VERDICT } = await load();
      const store = createHostKeyStore({ path: storePath });

      await store.verifyOrPin({ hostname: "example.internal", port: 22, keyBlob: keyBlob() });
      const result = await store.verifyOrPin({
        hostname: "example.internal",
        port: 22,
        keyBlob: keyBlob(),
      });

      expect(result.verdict).toBe(HOST_KEY_VERDICT.MATCHES);
    });

    it("refuses a changed key and leaves the original pin alone", async () => {
      const { createHostKeyStore, HOST_KEY_VERDICT } = await load();
      const store = createHostKeyStore({ path: storePath });

      await store.verifyOrPin({ hostname: "example.internal", port: 22, keyBlob: keyBlob() });
      const before = await readFile(storePath, "utf8");

      const result = await store.verifyOrPin({
        hostname: "example.internal",
        port: 22,
        keyBlob: keyBlob("ssh-ed25519", "DIFFERENT"),
      });

      expect(result.verdict).toBe(HOST_KEY_VERDICT.MISMATCH);
      // The pin is not overwritten — a changed key must never silently become
      // the new truth.
      expect(await readFile(storePath, "utf8")).toBe(before);
    });

    it("keeps a separate pin per host and per port", async () => {
      const { createHostKeyStore, HOST_KEY_VERDICT } = await load();
      const store = createHostKeyStore({ path: storePath });

      await store.verifyOrPin({ hostname: "a.internal", port: 22, keyBlob: keyBlob() });
      await store.verifyOrPin({ hostname: "b.internal", port: 22, keyBlob: keyBlob() });
      await store.verifyOrPin({ hostname: "a.internal", port: 2222, keyBlob: keyBlob() });

      const contents = await readFile(storePath, "utf8");
      expect(contents.trim().split("\n")).toHaveLength(3);

      // A different key for one host must not affect the others.
      const result = await store.verifyOrPin({
        hostname: "b.internal",
        port: 22,
        keyBlob: keyBlob("ssh-ed25519", "DIFFERENT"),
      });
      expect(result.verdict).toBe(HOST_KEY_VERDICT.MISMATCH);
    });

    it("survives reconstruction from disk", async () => {
      const { createHostKeyStore, HOST_KEY_VERDICT } = await load();
      await createHostKeyStore({ path: storePath }).verifyOrPin({
        hostname: "example.internal",
        port: 22,
        keyBlob: keyBlob(),
      });

      // A new store over the same file, as a later backend process would.
      const reopened = createHostKeyStore({ path: storePath });
      const result = await reopened.verifyOrPin({
        hostname: "example.internal",
        port: 22,
        keyBlob: keyBlob(),
      });
      expect(result.verdict).toBe(HOST_KEY_VERDICT.MATCHES);
    });
  });

  describe("fail-closed behaviour", () => {
    it("refuses a malformed store instead of treating it as nothing pinned", async () => {
      const { createHostKeyStore } = await load();
      const { mkdir } = await import("node:fs/promises");
      await mkdir(join(root, "ssh"), { recursive: true });
      await writeFile(storePath, "example.internal ssh-ed25519\n", "utf8");

      const store = createHostKeyStore({ path: storePath });
      await expect(
        store.verifyOrPin({ hostname: "example.internal", port: 22, keyBlob: keyBlob() }),
      ).rejects.toThrow(/malformed/);
    });

    it("refuses a store that is not a regular file", async () => {
      const { createHostKeyStore } = await load();
      const { mkdir } = await import("node:fs/promises");
      await mkdir(storePath, { recursive: true });

      const store = createHostKeyStore({ path: storePath });
      await expect(
        store.verifyOrPin({ hostname: "example.internal", port: 22, keyBlob: keyBlob() }),
      ).rejects.toThrow(/not a regular file/);
    });

    it("refuses a store reached through a symlink", async () => {
      const { createHostKeyStore } = await load();
      const { mkdir } = await import("node:fs/promises");
      await mkdir(join(root, "ssh"), { recursive: true });
      await writeFile(join(root, "elsewhere"), "a.internal ssh-ed25519 AAAA\n", "utf8");
      await symlink(join(root, "elsewhere"), storePath);

      const store = createHostKeyStore({ path: storePath });
      await expect(
        store.verifyOrPin({ hostname: "example.internal", port: 22, keyBlob: keyBlob() }),
      ).rejects.toThrow(/not a regular file/);
    });

    it("refuses a key it cannot read", async () => {
      const { createHostKeyStore } = await load();
      const store = createHostKeyStore({ path: storePath });
      await expect(
        store.verifyOrPin({ hostname: "example.internal", port: 22, keyBlob: Buffer.alloc(2) }),
      ).rejects.toThrow(/unusable host key/);
    });

    it("refuses a hostname that could forge another record", async () => {
      // The refusal happens before anything is written, so the store is left
      // exactly as it was.
      const { createHostKeyStore } = await load();
      const store = createHostKeyStore({ path: storePath });

      await expect(
        store.verifyOrPin({
          hostname: "#\ntrusted.internal",
          port: 22,
          keyBlob: keyBlob(),
        }),
      ).rejects.toThrow(/may not contain whitespace/);

      const { existsSync } = await import("node:fs");
      expect(existsSync(storePath)).toBe(false);
    });

    it("refuses a store that is not valid UTF-8", async () => {
      // The native store reads with `read_to_string`, which errors on invalid
      // UTF-8. A lossy decode would replace the bad bytes with U+FFFD and
      // accept a file the native store refuses, so the two modes would
      // disagree about whether the same file is valid.
      const { createHostKeyStore } = await load();
      const { mkdir } = await import("node:fs/promises");
      await mkdir(join(root, "ssh"), { recursive: true });
      await writeFile(storePath, Buffer.from([0x61, 0xff, 0x62, 0x0a]));

      const store = createHostKeyStore({ path: storePath });
      await expect(
        store.verifyOrPin({ hostname: "example.internal", port: 22, keyBlob: keyBlob() }),
      ).rejects.toThrow(/could not read the SSH host-key store/);
    });
  });

  describe("append-only writes", () => {
    it("does not destroy a record another writer appended", async () => {
      const { createHostKeyStore } = await load();
      const store = createHostKeyStore({ path: storePath });
      await store.verifyOrPin({ hostname: "a.internal", port: 22, keyBlob: keyBlob() });

      // Another writer — `ssh`, or the native app — appends its own record.
      await writeFile(
        storePath,
        `${await readFile(storePath, "utf8")}b.internal ssh-ed25519 BBBB\n`,
        "utf8",
      );

      await store.verifyOrPin({ hostname: "c.internal", port: 22, keyBlob: keyBlob() });

      const contents = await readFile(storePath, "utf8");
      expect(contents).toContain("a.internal ssh-ed25519");
      expect(contents).toContain("b.internal ssh-ed25519 BBBB");
      expect(contents).toContain("c.internal ssh-ed25519");
    });

    it("starts its own record on a new line when a writer stopped mid-line", async () => {
      const { createHostKeyStore } = await load();
      const { mkdir } = await import("node:fs/promises");
      await mkdir(join(root, "ssh"), { recursive: true });
      await writeFile(storePath, "a.internal ssh-ed25519 AAAA", "utf8");

      await createHostKeyStore({ path: storePath }).verifyOrPin({
        hostname: "b.internal",
        port: 22,
        keyBlob: keyBlob(),
      });

      const contents = await readFile(storePath, "utf8");
      expect(contents).toBe(
        `a.internal ssh-ed25519 AAAA\nb.internal ssh-ed25519 ${keyBlob().toString("base64")}\n`,
      );
    });
  });

  describe("file permissions", () => {
    it("keeps the store owner-only and its directory private", async () => {
      const { createHostKeyStore } = await load();
      await createHostKeyStore({ path: storePath }).verifyOrPin({
        hostname: "example.internal",
        port: 22,
        keyBlob: keyBlob(),
      });

      const fileMode = (await stat(storePath)).mode & 0o777;
      const directoryMode = (await stat(join(root, "ssh"))).mode & 0o777;
      expect(fileMode).toBe(0o600);
      expect(directoryMode).toBe(0o700);
    });
  });

  describe("the lockfile", () => {
    it("treats a lock it cannot read as held rather than stale", async () => {
      // The PID is written before the lock file's handle is closed, so a
      // reader never sees an empty lock — but if it does see one it cannot
      // parse, taking it would put two writers in the critical section. The
      // fail-closed direction is to refuse.
      const { createHostKeyStore } = await load();
      const { mkdir, writeFile } = await import("node:fs/promises");
      await mkdir(join(root, "ssh"), { recursive: true });
      await writeFile(`${storePath}.lock.node`, "not-a-pid\n", "utf8");

      const store = createHostKeyStore({ path: storePath, lockTimeoutMs: 150 });

      await expect(
        store.verifyOrPin({ hostname: "example.internal", port: 22, keyBlob: keyBlob() }),
      ).rejects.toThrow(/locked by another process/);

      // The store was left untouched: nothing was written while the lock was
      // held by someone else.
      const { existsSync } = await import("node:fs");
      expect(existsSync(storePath)).toBe(false);
    });

    it("reclaims a lock whose holder is gone", async () => {
      // A process that died without releasing the lock would otherwise wedge
      // every later connection.
      const { createHostKeyStore } = await load();
      const { mkdir, writeFile } = await import("node:fs/promises");
      const { spawnSync } = await import("node:child_process");
      await mkdir(join(root, "ssh"), { recursive: true });

      // The PID of a process that has already exited.
      const exited = spawnSync(process.execPath, ["-e", ""]);
      await writeFile(`${storePath}.lock.node`, `${exited.pid}\n`, "utf8");

      const store = createHostKeyStore({ path: storePath, lockTimeoutMs: 2000 });

      const result = await store.verifyOrPin({
        hostname: "example.internal",
        port: 22,
        keyBlob: keyBlob(),
      });

      expect(result.verdict).toBe("pinned");
      expect(existsSyncStore(storePath)).toBe(true);
    });
  });

  describe("the ssh2 verifier", () => {
    it("does not put the store's path in the message it refuses with", async () => {
      // #230 is about exactly this: raw `fs` text carries absolute
      // filesystem paths, and it must not reach a client. The store's own
      // failures name the file and the line — that detail stays on the
      // server as the error's cause.
      const { createHostKeyStore, createHostKeyVerifier } = await load();
      const { mkdir, writeFile } = await import("node:fs/promises");
      await mkdir(join(root, "ssh"), { recursive: true });
      await writeFile(storePath, "example.internal ssh-ed25519\n", "utf8");

      const verifier = createHostKeyVerifier({
        hostname: "example.internal",
        port: 22,
        store: createHostKeyStore({ path: storePath }),
      });

      const permitted = await new Promise<boolean>((resolve) => {
        verifier.verify(keyBlob(), resolve);
      });

      expect(permitted).toBe(false);
      const message = verifier.failure.error?.message ?? "";
      expect(message).not.toContain(storePath);
      expect(message).not.toContain(root);
      expect(message).not.toContain("known_hosts");
      // The detail is still on the server.
      expect(String(verifier.failure.error?.cause)).toContain("malformed");
    });

    it("keeps terminal control characters out of the message", async () => {
      // xterm.js reads U+009B as a CSI, so a hostname carrying one could
      // colour or clear the terminal over the real error message.
      const { createHostKeyStore, createHostKeyVerifier } = await load();
      const store = createHostKeyStore({ path: storePath });
      const verifier = createHostKeyVerifier({
        hostname: "evil\u009b31mFORGED\u009b0m.internal",
        port: 22,
        store,
      });

      // Pin first, then present a different key so the refusal has a
      // message to carry.
      await new Promise<boolean>((resolve) => {
        verifier.verify(keyBlob(), resolve);
      });
      await new Promise<boolean>((resolve) => {
        verifier.verify(keyBlob("ssh-ed25519", "DIFFERENT"), resolve);
      });

      const message = verifier.failure.error?.message ?? "";
      // The CSI introducer is what makes a terminal act on the rest. The
      // letters that followed it survive as ordinary text, which is inert.
      expect(message).not.toContain("\u009b");
      expect(message).not.toContain("\u001b");
      expect(
        Array.from(message).every((character) => {
          const code = character.codePointAt(0) ?? 0;
          return code >= 0x20 && code !== 0x7f && !(code >= 0x80 && code <= 0x9f);
        }),
      ).toBe(true);
      // The label is still readable, so the user can tell which host it was.
      expect(message).toContain("evil");
    });

    it("accepts the first key it sees and refuses a changed one", async () => {
      const { createHostKeyStore, createHostKeyVerifier } = await load();
      const store = createHostKeyStore({ path: storePath });
      const verifier = createHostKeyVerifier({
        hostname: "example.internal",
        port: 2222,
        store,
      });

      const first = await new Promise<boolean>((resolve) => {
        verifier.verify(keyBlob(), resolve);
      });
      expect(first).toBe(true);
      expect(verifier.failure.error).toBeNull();

      const second = await new Promise<boolean>((resolve) => {
        verifier.verify(keyBlob("ssh-ed25519", "DIFFERENT"), resolve);
      });
      expect(second).toBe(false);
      expect(verifier.failure.error?.message).toMatch(/Host key verification failed/);
      expect(verifier.failure.error?.message).toContain("example.internal:2222");
    });

    it("refuses when the store cannot be read", async () => {
      const { createHostKeyVerifier } = await load();
      const brokenStore = {
        async verifyOrPin() {
          throw new Error("the SSH host-key store is malformed");
        },
      };
      const verifier = createHostKeyVerifier({
        hostname: "example.internal",
        port: 22,
        store: brokenStore,
      });

      const permitted = await new Promise<boolean>((resolve) => {
        verifier.verify(keyBlob(), resolve);
      });
      expect(permitted).toBe(false);
      expect(verifier.failure.error?.message).toMatch(/Could not verify the host key/);
    });
  });
});
