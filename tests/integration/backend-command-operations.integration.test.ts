import { readFileSync, readdirSync } from "node:fs";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { sendJson } from "../../apps/desktop/server/backend-responses.mjs";
import {
  createBackendCommandOperations,
  sshFailureStage,
  waitForSshReady,
} from "../../apps/desktop/server/backend-command-operations.mjs";
import { OperationTimeoutError } from "../../apps/desktop/server/backend-deadline.mjs";

const host = { hostname: "caller-host.example" };
const target = { host, id: "caller-target-id", label: "Caller host label" };
const requireFromDesktop = createRequire(
  new URL("../../apps/desktop/package.json", import.meta.url)
);
const ssh2LibDirectory = dirname(requireFromDesktop.resolve("ssh2"));

function assignedLevelAfter(source: string, marker: string) {
  const markerIndex = source.indexOf(marker);
  if (markerIndex === -1) {
    throw new Error(`Installed ssh2 source no longer contains ${JSON.stringify(marker)}`);
  }
  const match = source.slice(markerIndex, markerIndex + 800).match(/\.level = ['"]([^'"]+)['"]/);
  if (!match?.[1]) {
    throw new Error(`Installed ssh2 no longer assigns an error level after ${JSON.stringify(marker)}`);
  }
  return match[1];
}

function readJavaScriptTree(directory: string): string {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        return [readJavaScriptTree(path)];
      }
      return entry.name.endsWith(".js") ? [readFileSync(path, "utf8")] : [];
    })
    .join("\n");
}

function serialize(body: unknown) {
  const recorded: { status?: number; body?: string } = {};
  sendJson(
    {
      writeHead(status: number) {
        recorded.status = status;
      },
      end(value: string) {
        recorded.body = value;
      },
    },
    200,
    body
  );
  expect(recorded.status).toBe(200);
  return recorded.body!;
}

function operations(readFile: ReturnType<typeof vi.fn>, runRemoteCommand: ReturnType<typeof vi.fn>) {
  return createBackendCommandOperations({
    expandHome: (path: string) => path.replace(/^~\//, "/fixture-home/"),
    readFile,
    runRemoteCommand,
  });
}

describe("#266: Node SSH responses disclose only typed failures", () => {
  it("maps the failure levels assigned by the installed ssh2 implementation", () => {
    const clientSource = readFileSync(join(ssh2LibDirectory, "client.js"), "utf8");
    const kexSource = readFileSync(join(ssh2LibDirectory, "protocol/kex.js"), "utf8");
    const hostVerificationFailure = kexSource.match(
      /doFatalError\(\s*this\._protocol,\s*['"](Host denied \(verification failed\))['"],\s*['"]([^'"]+)['"]/
    );
    if (!hostVerificationFailure?.[1] || !hostVerificationFailure[2]) {
      throw new Error("Installed ssh2 no longer exposes the expected host-verification failure");
    }

    expect(
      sshFailureStage({
        level: assignedLevelAfter(kexSource, "Error while computing DH secret"),
      })
    ).toBe("handshake");
    expect(
      sshFailureStage({
        message: hostVerificationFailure[1],
        level: hostVerificationFailure[2],
      })
    ).toBe("host-key-verification");
    expect(
      sshFailureStage({
        level: assignedLevelAfter(clientSource, "All configured authentication methods failed"),
      })
    ).toBe("authentication");
    expect(
      sshFailureStage({
        level: assignedLevelAfter(clientSource, "Timed out while waiting for handshake"),
      })
    ).toBe("handshake");
    expect(
      sshFailureStage({ level: assignedLevelAfter(clientSource, "Socket error:") })
    ).toBe("connect");
    expect(
      sshFailureStage({ level: assignedLevelAfter(clientSource, "Error while looking up") })
    ).toBe("connect");
    expect(
      sshFailureStage({ level: assignedLevelAfter(clientSource, "curAuth.agentCtx.init") })
    ).toBe("authentication");
    expect(readJavaScriptTree(ssh2LibDirectory)).not.toContain("client-ssh");
  });

  it("classifies client-timeout only while waiting for SSH readiness", async () => {
    const timeout = Object.assign(new Error("timeout"), { level: "client-timeout" });
    const preReadyClient = Object.assign(new EventEmitter(), { connect: vi.fn() });
    const preReadyStages: string[] = [];
    const preReady = waitForSshReady(
      preReadyClient,
      { hostname: "pre-ready.example" },
      undefined,
      (stage: string) => preReadyStages.push(stage)
    );

    preReadyClient.emit("error", timeout);
    await expect(preReady).rejects.toBe(timeout);
    expect(preReadyStages).toEqual(["handshake"]);

    const postReadyClient = Object.assign(new EventEmitter(), { connect: vi.fn() });
    const jumpClient = { end: vi.fn() };
    const postReadyStages: string[] = [];
    const postReady = waitForSshReady(
      postReadyClient,
      { hostname: "post-ready.example" },
      jumpClient,
      (stage: string) => postReadyStages.push(stage)
    );

    postReadyClient.emit("ready");
    await expect(postReady).resolves.toBe(postReadyClient);
    postReadyStages.push("output-read");
    postReadyClient.emit("error", timeout);

    expect(jumpClient.end).toHaveBeenCalled();
    expect(postReadyStages).toEqual(["output-read"]);
  });

  it("withholds fs error text and the expanded HOME path from copy-key", async () => {
    const sentinel = "TS_COPY_FS_PROBE_3b9075";
    const plantedError = new Error(`EACCES ${sentinel} /fixture-home/.ssh/caller.pub`);
    const readFile = vi.fn().mockRejectedValue(plantedError);
    const runRemoteCommand = vi.fn();

    const result = await operations(readFile, runRemoteCommand).copyKeyToHostBackend({
      privateKeyPath: "~/.ssh/caller",
      host,
    });
    const body = serialize(result);

    expect(readFile).toHaveBeenCalledWith("/fixture-home/.ssh/caller.pub", "utf8");
    expect(runRemoteCommand).not.toHaveBeenCalled();
    expect(result).toEqual({
      ok: false,
      failure: { reason: "public-key-unreadable", publicKeyPath: "~/.ssh/caller.pub" },
    });
    expect(body).toContain("~/.ssh/caller.pub");
    expect(body).not.toContain(sentinel);
    expect(body).not.toContain("/fixture-home");
    expect(JSON.parse(body)).not.toHaveProperty("reason");
  });

  it("withholds a connection error while retaining copy-key host identity", async () => {
    const sentinel = "TS_COPY_SSH2_PROBE_0ff91a";
    const readFile = vi.fn().mockResolvedValue("ssh-ed25519 AAAA caller");
    const runRemoteCommand = vi.fn(async (...args: unknown[]) => {
      const setStage = args[2] as (stage: string) => void;
      setStage("connect");
      throw new Error(`ssh2 connect ${sentinel}`);
    });

    const result = await operations(readFile, runRemoteCommand).copyKeyToHostBackend({
      privateKeyPath: "~/.ssh/caller",
      host,
    });
    const body = serialize(result);

    expect(runRemoteCommand).toHaveBeenCalled();
    expect(result).toMatchObject({
      ok: false,
      failure: {
        reason: "remote-command-failed",
        hostname: host.hostname,
        command: { reason: "ssh-failed", stage: "connect" },
      },
    });
    expect(body).toContain(host.hostname);
    expect(body).not.toContain(sentinel);
    expect(JSON.parse(body)).not.toHaveProperty("reason");
  });

  it("withholds an ssh2 exec error while retaining snippet target identity", async () => {
    const sentinel = "TS_SNIPPET_SSH2_PROBE_7c125e";
    const runRemoteCommand = vi.fn(async (...args: unknown[]) => {
      const setStage = args[2] as (stage: string) => void;
      setStage("exec-request");
      throw new Error(`ssh2 exec ${sentinel}`);
    });

    const result = await operations(vi.fn(), runRemoteCommand).executeRemoteCommand(target, "uptime");
    const body = serialize(result);

    expect(runRemoteCommand).toHaveBeenCalled();
    expect(result).toMatchObject({
      ok: false,
      failure: { reason: "ssh-failed", stage: "exec-request" },
    });
    expect(body).toContain(target.id);
    expect(body).toContain(target.label);
    expect(body).not.toContain(sentinel);
    expect(JSON.parse(body)).not.toHaveProperty("errorMessage");
  });

  it("retains the rounded timeout budget as typed response data", async () => {
    const runRemoteCommand = vi
      .fn()
      .mockRejectedValue(new OperationTimeoutError("caller-controlled prose", 60_600));

    const result = await operations(vi.fn(), runRemoteCommand).executeRemoteCommand(
      target,
      "uptime"
    );
    const body = serialize(result);

    expect(result).toMatchObject({
      ok: false,
      failure: { reason: "timed-out", timeoutSeconds: 61 },
    });
    expect(body).toContain('"timeoutSeconds":61');
    expect(body).not.toContain("caller-controlled prose");
  });

  it("keeps snippet stderr but does not relay copy-key command stderr", async () => {
    const remoteStderr = "REMOTE_COMMAND_STDERR_CALLER_CONTROLS";
    const failedCommand = {
      ok: false,
      stdout: "",
      stderr: remoteStderr,
      exitCode: 23,
    };
    const snippetResult = await operations(vi.fn(), vi.fn().mockResolvedValue(failedCommand))
      .executeRemoteCommand(target, "false");
    const copyResult = await operations(
      vi.fn().mockResolvedValue("ssh-ed25519 AAAA caller"),
      vi.fn().mockResolvedValue(failedCommand)
    ).copyKeyToHostBackend({ privateKeyPath: "~/.ssh/caller", host });

    const snippetBody = serialize(snippetResult);
    const copyBody = serialize(copyResult);
    expect(snippetResult).toMatchObject({
      ok: false,
      failure: { reason: "remote-command-exited", exitCode: 23 },
    });
    expect(snippetBody).toContain(remoteStderr);
    expect(snippetBody).not.toContain("errorMessage");
    expect(copyResult).toMatchObject({
      ok: false,
      failure: { reason: "remote-command-failed" },
    });
    expect(copyBody).not.toContain(remoteStderr);
    expect(JSON.parse(copyBody)).not.toHaveProperty("reason");
  });
});
