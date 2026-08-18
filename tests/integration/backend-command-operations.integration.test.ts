import { describe, expect, it, vi } from "vitest";

import { sendJson } from "../../apps/desktop/server/backend-responses.mjs";
import { createBackendCommandOperations } from "../../apps/desktop/server/backend-command-operations.mjs";
import { OperationTimeoutError } from "../../apps/desktop/server/backend-deadline.mjs";

const host = { hostname: "caller-host.example" };
const target = { host, id: "caller-target-id", label: "Caller host label" };

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
    expandHome: (path: string) => path.replace(/^~\//, "/Users/operator/"),
    readFile,
    runRemoteCommand,
  });
}

describe("#266: Node SSH responses disclose only typed failures", () => {
  it("withholds fs error text and the expanded HOME path from copy-key", async () => {
    const sentinel = "TS_COPY_FS_PROBE_3b9075";
    const plantedError = new Error(`EACCES ${sentinel} /Users/operator/.ssh/caller.pub`);
    const readFile = vi.fn().mockRejectedValue(plantedError);
    const runRemoteCommand = vi.fn();

    const result = await operations(readFile, runRemoteCommand).copyKeyToHostBackend({
      privateKeyPath: "~/.ssh/caller",
      host,
    });
    const body = serialize(result);

    expect(readFile).toHaveBeenCalledWith("/Users/operator/.ssh/caller.pub", "utf8");
    expect(runRemoteCommand).not.toHaveBeenCalled();
    expect(result).toEqual({
      ok: false,
      failure: { reason: "public-key-unreadable", publicKeyPath: "~/.ssh/caller.pub" },
    });
    expect(body).toContain("~/.ssh/caller.pub");
    expect(body).not.toContain(sentinel);
    expect(body).not.toContain("/Users/operator");
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
      failure: { reason: "remote-command-exited", exitCode: 23 },
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
