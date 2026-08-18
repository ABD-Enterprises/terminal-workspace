// The response boundary lives outside backend.mjs so it can be tested without
// importing the server and binding its port. I/O is injected by backend.mjs.
import { OperationTimeoutError } from "./backend-deadline.mjs";
import { shellSingleQuote } from "./backend-shell.mjs";

function commandResult(target, fields) {
  return {
    targetId: target.id,
    label: target.label,
    stdout: "",
    stderr: "",
    exitCode: null,
    ...fields,
  };
}

export function sshFailureStage(error) {
  switch (error?.level) {
    case "handshake":
      return error.message === "Host denied (verification failed)"
        ? "host-key-verification"
        : "handshake";
    case "client-authentication":
    case "agent":
      return "authentication";
    case "client-timeout":
      return "handshake";
    case "client-socket":
    case "client-dns":
      return "connect";
    default:
      return undefined;
  }
}

export function waitForSshReady(client, connectConfig, jumpClient, setStage) {
  let settled = false;
  return new Promise((resolve, reject) => {
    client.once("ready", () => {
      if (settled) return;
      settled = true;
      if (jumpClient) {
        client.once("close", () => jumpClient.end());
      }
      resolve(client);
    });
    client.on("error", (error) => {
      jumpClient?.end();
      if (settled) return;
      settled = true;
      const failureStage = sshFailureStage(error);
      if (failureStage) {
        setStage?.(failureStage);
      }
      reject(error);
    });
    client.connect(connectConfig);
  });
}

export function createBackendCommandOperations({ expandHome, readFile, runRemoteCommand }) {
  async function executeRemoteCommand(target, command) {
    let stage = "configuration";
    try {
      const result = await runRemoteCommand(target, command, (nextStage) => {
        stage = nextStage;
      });
      return commandResult(target, {
        ok: result.ok,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        ...(result.ok
          ? {}
          : {
              failure: {
                reason: "remote-command-exited",
                exitCode: result.exitCode,
              },
            }),
      });
    } catch (error) {
      return commandResult(target, {
        ok: false,
        failure:
          error instanceof OperationTimeoutError
            ? {
                reason: "timed-out",
                timeoutSeconds: Math.round(error.timeoutMs / 1000),
              }
            : { reason: "ssh-failed", stage },
      });
    }
  }

  async function copyKeyToHostBackend({ privateKeyPath, host }) {
    if (!privateKeyPath || typeof privateKeyPath !== "string") {
      return { ok: false, failure: { reason: "private-key-path-required" } };
    }
    if (!host || !host.hostname) {
      return { ok: false, failure: { reason: "target-host-required" } };
    }

    // Keep the caller's HOME-relative spelling on the wire: expanding it is
    // necessary for fs access but would disclose the local absolute HOME path.
    const publicKeyPath = `${privateKeyPath}.pub`;
    const expandedPublicKeyPath = expandHome(publicKeyPath);
    let publicKey;
    try {
      publicKey = (await readFile(expandedPublicKeyPath, "utf8")).trim();
    } catch {
      return {
        ok: false,
        failure: { reason: "public-key-unreadable", publicKeyPath },
      };
    }
    if (!publicKey) {
      return {
        ok: false,
        failure: { reason: "public-key-empty", publicKeyPath },
      };
    }

    const quoted = shellSingleQuote(publicKey);
    const command =
      "mkdir -p ~/.ssh && chmod 700 ~/.ssh && " +
      `printf '%s\\n' ${quoted} >> ~/.ssh/authorized_keys && ` +
      "chmod 600 ~/.ssh/authorized_keys && echo OK";
    const result = await executeRemoteCommand(
      { id: host.hostname, label: host.hostname, host },
      command
    );
    if (result.ok && result.stdout.trim().endsWith("OK")) {
      return { ok: true };
    }

    // Deliberate behavior change: this backend-authored command's stderr is an
    // internal diagnostic, unlike stderr from a user-authored snippet command.
    return {
      ok: false,
      failure: {
        reason: "remote-command-failed",
        hostname: host.hostname,
        command:
          result.failure ?? {
            reason: "remote-command-exited",
            exitCode: result.exitCode,
          },
      },
    };
  }

  return { copyKeyToHostBackend, executeRemoteCommand };
}
