import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

// QWEN security finding S-2: the Node backend's generateKeyPair() previously
// passed the user's passphrase to ssh-keygen via the `-N <pass>` argv flag,
// which is visible in `ps -ef` to any local user. The Tauri backend was
// already protected via the SSH_ASKPASS pattern (see
// src-tauri/src/native_transport.rs:563-606); this test guards the matching
// fix in apps/desktop/server/backend.mjs.
//
// Two cases:
//   1. Source-level guard: the backend file contains the SSH_ASKPASS shim
//      and does NOT contain the leak pattern. Cheap regression catch.
//   2. Functional proof: an end-to-end ssh-keygen invocation using the same
//      askpass technique produces a usable key file without exposing the
//      passphrase to `ps` while ssh-keygen is running.

const execFileAsync = promisify(execFile);

function shellSingleQuote(value: string): string {
  return "'" + value.replace(/'/g, "'\\''") + "'";
}

describe("S-2: ssh-keygen passphrase does not leak via argv", () => {
  it("backend.mjs source does not pass the passphrase via -N argv", async () => {
    const source = await readFile(
      "apps/desktop/server/backend.mjs",
      "utf8"
    );

    // The fix uses SSH_ASKPASS. If somebody re-introduces `-N", passphrase`
    // they will fail this test.
    expect(source).toContain("SSH_ASKPASS");
    expect(source).toContain("SSH_ASKPASS_REQUIRE");

    // Find the generateKeyPair function body and assert the leak pattern is
    // absent inside it. We don't grep the whole file because comments
    // referring to the old pattern would false-positive.
    const fnStart = source.indexOf("async function generateKeyPair");
    expect(fnStart).toBeGreaterThan(-1);
    const fnEnd = source.indexOf("\n}\n", fnStart);
    expect(fnEnd).toBeGreaterThan(fnStart);
    const fnBody = source.slice(fnStart, fnEnd);

    // The historical leak pattern. If you bring it back, fix the askpass
    // path instead.
    expect(fnBody).not.toMatch(/"-N",\s*passphrase/);
    expect(fnBody).not.toMatch(/'-N',\s*passphrase/);
  });

  it("SSH_ASKPASS pattern produces a working key with a non-empty passphrase, without leaking it to ps", async () => {
    // 32-char random-ish probe; if any process argv contains this exact
    // string while ssh-keygen runs, the leak is back.
    const probe = "TS_LEAK_PROBE_b59c1d4e7a2f0938a516c";
    const sessionDir = await mkdtemp(join(tmpdir(), "termsnip-keygen-test-"));
    const passPath = join(sessionDir, "pass");
    const askpassPath = join(sessionDir, "askpass.sh");
    const keyPath = join(sessionDir, "id_test_ed25519");

    try {
      await writeFile(passPath, probe, { mode: 0o600 });
      await writeFile(
        askpassPath,
        `#!/bin/sh\nexec /bin/cat -- ${shellSingleQuote(passPath)}\n`,
        { mode: 0o700 }
      );

      // Mirror the production invocation: no -N flag, SSH_ASKPASS provides
      // the passphrase via stdin twice (enter + confirm).
      const baseArgs = ["-q", "-t", "ed25519", "-f", keyPath, "-C", "leak-probe"];

      // Snapshot ps every 25ms while ssh-keygen runs. If the probe string
      // ever shows up in argv, the test fails.
      let probeSeenInPs = false;
      let psPollerActive = true;
      const pollPs = async () => {
        while (psPollerActive) {
          try {
            const { stdout } = await execFileAsync("/bin/ps", ["-eo", "args"]);
            if (stdout.includes(probe)) {
              probeSeenInPs = true;
              psPollerActive = false;
              break;
            }
          } catch {
            // ps may transiently fail; ignore.
          }
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
      };
      const psWatcher = pollPs();

      try {
        await execFileAsync("/usr/bin/ssh-keygen", baseArgs, {
          env: {
            ...process.env,
            SSH_ASKPASS: askpassPath,
            SSH_ASKPASS_REQUIRE: "force",
            DISPLAY: ":0",
          },
        });
      } finally {
        psPollerActive = false;
        await psWatcher;
      }

      // 1. The key file exists.
      const keyContents = await readFile(keyPath, "utf8");
      expect(keyContents).toMatch(/-----BEGIN OPENSSH PRIVATE KEY-----/);

      // 2. The probe was never seen in any process argv during the run.
      expect(probeSeenInPs).toBe(false);
    } finally {
      await rm(sessionDir, { recursive: true, force: true });
    }
  });
});
