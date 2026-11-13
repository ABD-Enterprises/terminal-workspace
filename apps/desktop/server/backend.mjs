import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rmdir,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { connect as connectNet, createServer as createNetServer } from "node:net";
import { basename, dirname, join, normalize, posix as posixPath } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import os from "node:os";
import { WebSocketServer } from "ws";
import {
  isRequestAuthorized,
  loadOrCreateBackendToken,
  parseAllowedOrigins,
} from "./auth.mjs";
import {
  describeServerListenError,
  shutdownBackend,
} from "./backend-lifecycle.mjs";
import { globMatcher } from "./backend-glob.mjs";
import { createStaticHandler } from "./backend-static.mjs";
import {
  buildExecCommand,
  getChannelEnvironment,
  shellSingleQuote,
} from "./backend-shell.mjs";
import {
  REMOTE_COMMAND_TIMEOUT_MS,
  withDeadline,
} from "./backend-deadline.mjs";
import { createWithSftp } from "./backend-sftp.mjs";
import { respondError, sendJson } from "./backend-responses.mjs";
import { requestAuthContext } from "./backend-ssh-auth.mjs";
import {
  createBackendCommandOperations,
} from "./backend-command-operations.mjs";
import {
  bufferDetachedOutput,
  isJsonContentType,
  readJson,
  SFTP_UPLOAD_MAX_BYTES,
} from "./backend-buffers.mjs";
import { readBoundedRegularFile, writeNewPrivateFile } from "./backend-files.mjs";
import {
  createHostKeyStore,
  parseKeyscanOutput,
  resolveAppDataDirectory,
} from "./backend-host-keys.mjs";
import {
  projectSshConfigResolutionFailure,
  resolveSshConfigPath,
  SshConfigResolutionFailure,
  SshConfigResolutionRegistry,
} from "./ssh-config-resolution.mjs";

import { createSshSessionManager } from "./backend-ssh-session.mjs";
import { createSftpOperations } from "./backend-sftp-ops.mjs";
const __dirname = dirname(fileURLToPath(import.meta.url));
const appRoot = normalize(join(__dirname, ".."));
const distRoot = join(appRoot, "dist");
const serveStatic = createStaticHandler({ root: distRoot });
const port = Number.parseInt(process.env.TERMSNIP_BACKEND_PORT ?? "8790", 10);

// Per-launch auth gate. The token comes from TERMSNIP_BACKEND_TOKEN or is
// generated fresh, and is also written to a 0600 file in a private app data
// directory for manual use (#474). Browser callers are authenticated by a
// matching Origin header. See parity-and-hardening-review §3.S-4 / §3.S-8.
let backendAuth;
try {
  backendAuth = loadOrCreateBackendToken({
    env: process.env,
    stateDir: resolveAppDataDirectory(process.env),
  });
} catch (error) {
  console.error(`[termsnip] backend not started: ${error.message}`);
  process.exit(1);
}
const allowedOrigins = parseAllowedOrigins(process.env.TERMSNIP_ALLOWED_ORIGINS);
console.error(
  `[termsnip] backend auth gate: token source=${backendAuth.source}`
);
console.error(`[termsnip] backend allowed origins: ${allowedOrigins.join(", ")}`);

function denyUnauthorized(response, decision) {
  response.writeHead(403, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify({ error: "Unauthorized", reason: decision.reason }));
}

const sessions = new Map();
const execFileAsync = promisify(execFile);
const forwards = new Map();

function expandHome(pathname) {
  if (!pathname) {
    return pathname;
  }

  if (!pathname.startsWith("~/")) {
    return pathname;
  }

  return join(os.homedir(), pathname.slice(2));
}

// #93: SSH config Include glob expansion. SSH configs are text; cap each
// matched file and the total match count so a pathological pattern can't
// exhaust the import.
const SSH_CONFIG_MAX_BYTES = 1024 * 1024;
const SSH_CONFIG_GLOB_MAX_MATCHES = 256;
// The HTTP API has no import-session boundary, so keep only the 4,096 most
// recently used canonical paths. Evicted keys fail as invalid resolution context.
const SSH_CONFIG_RESOLUTION_REGISTRY = new SshConfigResolutionRegistry();

/**
 * Expand an Include glob to the files it matches under ~/.ssh, each with its
 * content. The directory and every match are resolved with realpath and must
 * stay under the canonical ~/.ssh root — anything outside is refused/dropped.
 * Only the final path component may be a glob.
 */
async function globSshConfigFiles(pattern, context) {
  const sshRoot = await realpath(join(os.homedir(), ".ssh"));
  const expanded = resolveSshConfigPath(
    pattern,
    context,
    sshRoot,
    SSH_CONFIG_RESOLUTION_REGISTRY
  );
  const parent = dirname(expanded);
  const filePattern = basename(expanded);

  if (/[*?[]/.test(parent)) {
    throw new Error("glob in a directory component is not supported");
  }

  const parentReal = await realpath(parent);
  const rootPrefix = sshRoot.endsWith("/") ? sshRoot : `${sshRoot}/`;
  if (parentReal !== sshRoot && !parentReal.startsWith(rootPrefix)) {
    throw new Error(`glob directory ${parentReal} is not under ${sshRoot}`);
  }

  const matcher = globMatcher(filePattern);
  if (matcher === null) {
    // The pattern is not expressible as a Unicode regex (an unpaired
    // surrogate), so it cannot match any file. Skipping it explicitly keeps
    // the request from failing on a name macOS allowed but UTF-8 cannot
    // represent.
    return { matches: [], truncated: false };
  }
  // #486: OpenSSH applies Include glob matches in byte order (glob(3) under
  // the C locale), and the first setting obtained wins. Order every matching
  // name by its UTF-8 bytes and only then apply the cap, so the files kept are
  // the ones OpenSSH would apply first.
  const names = (await readdir(parentReal))
    .filter((name) => matcher.test(name))
    .sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
  const matches = [];
  let truncated = false;
  for (const name of names) {
    if (matches.length >= SSH_CONFIG_GLOB_MAX_MATCHES) {
      truncated = true;
      break;
    }
    let real;
    try {
      real = await realpath(join(parentReal, name));
    } catch {
      continue;
    }
    if (real !== sshRoot && !real.startsWith(rootPrefix)) {
      continue;
    }
    const content = await readBoundedRegularFile(real, SSH_CONFIG_MAX_BYTES);
    if (content === undefined) {
      continue;
    }
    matches.push({
      cycleKey: SSH_CONFIG_RESOLUTION_REGISTRY.remember(real),
      // This is the directory entry selected by the caller's final glob
      // component, not a resolved path or the target of a symlink.
      name,
      content,
    });
  }

  return { matches, truncated };
}

function getErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function normalizeKeyAlgorithm(value) {
  const algorithm = value.toUpperCase();

  if (algorithm.includes("ED25519")) {
    return "ED25519";
  }

  if (algorithm.includes("ECDSA")) {
    return "ECDSA";
  }

  if (algorithm.includes("RSA")) {
    return "RSA";
  }

  return "UNKNOWN";
}

function broadcast(session, message) {
  if (session.ws && session.ws.readyState === 1) {
    session.ws.send(JSON.stringify(message));
  } else if (message.type === "data") {
    bufferDetachedOutput(session, message.data);
  }
}

function failSession(session, error) {
  session.state = "error";
  // Remembered, not just broadcast. The handshake can fail before the
  // websocket attaches — the renderer creates the session and opens the socket
  // in two steps — and a broadcast to nobody is a message the user never sees.
  // A failed host-key verification is exactly that case, and its reason is the
  // whole point of reporting it.
  session.failureMessage = getErrorMessage(error);
  broadcast(session, {
    type: "error",
    message: session.failureMessage,
  });
}

/**
 * The durable host-key store, created once per backend process.
 *
 * The path is resolved from the environment on first use, so a test that sets
 * `TERMSNIP_STATE_DIR` before the first connection gets its own store and
 * never touches the developer's real one.
 */
let hostKeyStore = null;

function getHostKeyStore() {
  if (!hostKeyStore) {
    hostKeyStore = createHostKeyStore();
  }
  return hostKeyStore;
}

const {
  connectClient,
  createSshSession,
} = createSshSessionManager({
  sessions,
  getHostKeyStore,
  closeForwardsForSession,
  broadcast,
  failSession,
  expandHome,
});

const withSftp = createWithSftp({ connectClient });

const {
  listRemoteDirectory,
  createRemoteDirectory,
  renameRemoteEntry,
  deleteRemoteEntry,
  uploadRemoteFile,
  sendRemoteFile,
} = createSftpOperations({ withSftp });

function serializeForward(forward) {
  return {
    id: forward.id,
    direction: forward.direction,
    sessionId: forward.sessionId,
    localHost: forward.localHost,
    localPort: forward.localPort,
    remoteHost: forward.remoteHost,
    remotePort: forward.remotePort,
    createdAt: forward.createdAt,
  };
}

async function closeLocalForward(forwardId) {
  const forward = forwards.get(forwardId);
  if (!forward) {
    return false;
  }

  if (forward.direction === "local") {
    await new Promise((resolve, reject) => {
      forward.server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  } else {
    const session = sessions.get(forward.sessionId);
    if (session) {
      session.client.off("tcp connection", forward.onConnection);
      await new Promise((resolve, reject) => {
        session.client.unforwardIn(forward.remoteHost, forward.remotePort, (error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    }
  }

  forwards.delete(forwardId);
  return true;
}

async function closeForwardsForSession(sessionId) {
  const forwardIds = Array.from(forwards.values())
    .filter((forward) => forward.sessionId === sessionId)
    .map((forward) => forward.id);

  await Promise.all(
    forwardIds.map((forwardId) => closeLocalForward(forwardId).catch(() => false))
  );
}

async function createLocalForward({ localHost, localPort, remoteHost, remotePort, sessionId }) {
  const session = sessions.get(sessionId);
  if (!session) {
    throw new Error("Session not found");
  }

  const server = createNetServer((socket) => {
    session.client.forwardOut(
      socket.remoteAddress ?? "127.0.0.1",
      socket.remotePort ?? 0,
      remoteHost,
      remotePort,
      (error, upstream) => {
        if (error) {
          socket.destroy(error);
          return;
        }

        socket.pipe(upstream);
        upstream.pipe(socket);
        upstream.on("error", () => socket.destroy());
        socket.on("error", () => upstream.end());
      }
    );
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(localPort, localHost, () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  const boundPort = typeof address === "object" && address ? address.port : localPort;
  const forward = {
    id: randomUUID(),
    direction: "local",
    sessionId,
    localHost,
    localPort: boundPort,
    remoteHost,
    remotePort,
    createdAt: new Date().toISOString(),
    server,
  };

  forwards.set(forward.id, forward);
  return serializeForward(forward);
}

async function createRemoteForward({ localHost, localPort, remoteHost, remotePort, sessionId }) {
  const session = sessions.get(sessionId);
  if (!session) {
    throw new Error("Session not found");
  }

  const forward = {
    id: randomUUID(),
    direction: "remote",
    sessionId,
    localHost,
    localPort,
    remoteHost,
    remotePort,
    createdAt: new Date().toISOString(),
    onConnection: null,
  };

  forward.onConnection = (details, accept, reject) => {
    if (details.destIP !== forward.remoteHost || details.destPort !== forward.remotePort) {
      reject();
      return;
    }

    const upstream = accept();
    const localSocket = connectNet(forward.localPort, forward.localHost);

    upstream.pipe(localSocket);
    localSocket.pipe(upstream);
    upstream.on("error", () => localSocket.destroy());
    localSocket.on("error", () => upstream.destroy());
  };

  session.client.on("tcp connection", forward.onConnection);

  try {
    const assignedPort = await new Promise((resolve, reject) => {
      session.client.forwardIn(remoteHost, remotePort, (error, boundPort) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(boundPort ?? remotePort);
      });
    });

    forward.remotePort = assignedPort;
    forwards.set(forward.id, forward);
    return serializeForward(forward);
  } catch (error) {
    session.client.off("tcp connection", forward.onConnection);
    throw error;
  }
}

async function inspectKey(pathname) {
  const resolvedPath = expandHome(pathname);
  await stat(resolvedPath);

  const { stdout } = await execFileAsync("/usr/bin/ssh-keygen", ["-lf", resolvedPath]);
  const summary = stdout.trim();
  const match = summary.match(/^(\d+)\s+(\S+)\s+(.+?)\s+\(([^)]+)\)$/);

  let publicKeyPath;
  try {
    await stat(`${resolvedPath}.pub`);
    publicKeyPath = `${resolvedPath}.pub`;
  } catch {
    publicKeyPath = undefined;
  }

  return {
    algorithm: normalizeKeyAlgorithm(match?.[4] ?? "UNKNOWN"),
    bits: Number.parseInt(match?.[1] ?? "0", 10) || 0,
    fingerprint: match?.[2] ?? "",
    comment: match?.[3] ?? posixPath.basename(resolvedPath),
    privateKeyPath: resolvedPath,
    publicKeyPath,
  };
}

async function generateKeyPair({ comment, passphrase, path, type }) {
  const resolvedPath = expandHome(path);

  await mkdir(dirname(resolvedPath), { recursive: true });

  try {
    await stat(resolvedPath);
    throw new Error("Target private key path already exists");
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }

  const baseArgs = ["-q", "-t", type, "-f", resolvedPath, "-C", comment];
  if (type === "rsa") {
    baseArgs.splice(3, 0, "-b", "4096");
  }
  if (type === "ecdsa") {
    baseArgs.splice(3, 0, "-b", "521");
  }

  const passphraseValue = passphrase ?? "";

  if (passphraseValue.length === 0) {
    // Empty passphrase — `-N ""` in argv leaks nothing.
    await execFileAsync("/usr/bin/ssh-keygen", [...baseArgs, "-N", ""]);
    return inspectKey(resolvedPath);
  }

  // Non-empty passphrase. The passphrase MUST NOT appear in argv (`ps`
  // would expose it). Mirror the Tauri pattern from
  // src-tauri/src/native_transport.rs:563-606 — write the passphrase to a
  // 0600 file in a private temp dir, hand ssh-keygen an SSH_ASKPASS shim
  // that prints it, scrub both files when done. Originally reported as
  // QWEN security finding S-2 against this Node code path; the Tauri
  // path was already protected.
  const sessionDir = await mkdtemp(join(os.tmpdir(), "termsnip-keygen-"));
  const passPath = join(sessionDir, "pass");
  const askpassPath = join(sessionDir, "askpass.sh");

  try {
    await writeFile(passPath, passphraseValue, { mode: 0o600 });
    // The askpass shim cats the pass file rather than embedding the
    // passphrase, so the script body itself never holds the secret.
    await writeFile(
      askpassPath,
      `#!/bin/sh\nexec /bin/cat -- ${shellSingleQuote(passPath)}\n`,
      { mode: 0o700 }
    );

    await execFileAsync("/usr/bin/ssh-keygen", baseArgs, {
      env: {
        ...process.env,
        SSH_ASKPASS: askpassPath,
        // SSH_ASKPASS_REQUIRE=force makes ssh-keygen prefer the askpass
        // shim even when a TTY is attached. OpenSSH >= 8.4 (macOS 12+).
        SSH_ASKPASS_REQUIRE: "force",
        // ssh-keygen historically only consults SSH_ASKPASS when DISPLAY
        // is set. Any non-empty value suffices; the shim ignores it.
        DISPLAY: ":0",
      },
    });
  } finally {
    // Best-effort scrub: overwrite with zeros, then unlink, then drop
    // the dir. Run regardless of whether ssh-keygen succeeded.
    try {
      await writeFile(passPath, Buffer.alloc(passphraseValue.length, 0));
    } catch {
      // ignore
    }
    try {
      await unlink(passPath);
    } catch {
      // ignore
    }
    try {
      await unlink(askpassPath);
    } catch {
      // ignore
    }
    try {
      await rmdir(sessionDir);
    } catch {
      // ignore
    }
  }

  return inspectKey(resolvedPath);
}

/**
 * T13: write a pasted private key body to disk and return inspect
 * metadata. 0600 perms, atomic-ish (write to tmp + rename), refuses to
 * overwrite an existing file (the user must delete the old key first).
 */
async function importPrivateKeyFromBody({ path, body }) {
  if (!path || typeof path !== "string") {
    throw new Error("A destination path is required.");
  }
  if (!body || typeof body !== "string" || body.trim().length === 0) {
    throw new Error("A key body is required.");
  }
  const resolvedPath = expandHome(path);
  await mkdir(dirname(resolvedPath), { recursive: true });
  // Normalize line endings + ensure a trailing newline (some keys
  // arrive without one and ssh-keygen rejects them).
  const normalized = body.replace(/\r\n?/g, "\n").replace(/\n*$/, "\n");
  // Exclusive create: refuses an existing key atomically instead of a stat()
  // pre-check that a key created in between would slip past and be overwritten.
  await writeNewPrivateFile(resolvedPath, normalized);
  return inspectKey(resolvedPath);
}

/**
 * #182: a remote command now carries a total deadline.
 *
 * ssh2 only bounds the initial connect (`readyTimeout`), so an exec against a
 * host that is reachable but unresponsive never settled — and because the
 * snippet endpoint joins targets with `Promise.all`, ONE such host withheld
 * every other host's result forever. Giving each host a deadline is what fixes
 * the batch: no target can stay pending, so the join always completes.
 *
 * The deadline is armed around the connect too, not just the exec. A jump host
 * whose forwardOut never answers hangs before any channel exists.
 */
async function runRemoteCommand(target, command, setStage) {
  if (typeof setStage === "function") {
    return await withDeadline(REMOTE_COMMAND_TIMEOUT_MS, async ({ onTimeout }) => {
      const client = await connectClient(target.host, setStage);
      // Destroy, not end(): a graceful close negotiates with a peer that has
      // already proven unresponsive.
      onTimeout(() => client.destroy());
      setStage("exec-request");
      const channelEnvironment = getChannelEnvironment(target.host.environment);
      const execOptions = channelEnvironment ? { env: channelEnvironment } : undefined;
      const resolvedCommand = buildExecCommand(command, target.host.environment);

      try {
        return await new Promise((resolve, reject) => {
          const handleExec = (error, stream) => {
            if (error) {
              reject(error);
              return;
            }

            setStage("output-read");
            onTimeout(() => stream.destroy());

            let stdout = "";
            let stderr = "";

            stream.on("data", (chunk) => {
              stdout += chunk.toString("utf8");
            });
            stream.stderr.on("data", (chunk) => {
              stderr += chunk.toString("utf8");
            });
            stream.on("close", (code) => {
              resolve({
                targetId: target.id,
                label: target.label,
                ok: code === 0,
                stdout,
                stderr,
                exitCode: code ?? null,
              });
            });
          };

          if (execOptions) {
            client.exec(resolvedCommand, execOptions, handleExec);
          } else {
            client.exec(resolvedCommand, handleExec);
          }
        });
      } finally {
        client.end();
      }
    });
  }
  throw new TypeError("A remote-command stage reporter is required");
}

const { copyKeyToHostBackend, executeRemoteCommand } = createBackendCommandOperations({
  expandHome,
  readFile,
  runRemoteCommand,
});

async function scanKnownHost({ hostname, port }) {
  const { stdout } = await execFileAsync("/usr/bin/ssh-keyscan", [
    "-p",
    String(port),
    "-T",
    "5",
    hostname,
  ]);

  return parseKeyscanOutput(stdout, { hostname, port });
}

const routes = new Map([
  [
    "GET /api/backend/status",
    async (request, response) => {
      sendJson(response, 200, { ok: true });
    },
  ],
  [
    "POST /api/backend/status",
    async (request, response) => {
      sendJson(response, 200, { ok: true });
    },
  ],
  [
    "POST /api/backend/sessions",
    async (request, response) => {
      try {
        const body = await readJson(request);
        const host = body.host;

        if (!host?.hostname || !host?.username || !host?.port) {
          sendJson(response, 400, { error: "Missing host connection fields" });
          return;
        }

        if (host.authMethod === "password" && !host.password) {
          sendJson(response, 400, { error: "Password auth selected but no password provided" });
          return;
        }

        if (host.authMethod === "privateKey" && !host.privateKeyPath) {
          sendJson(response, 400, { error: "Private key auth selected but no key path provided" });
          return;
        }

        if (host.authMethod === "none") {
          sendJson(response, 400, { error: "Host is configured without SSH auth" });
          return;
        }

        const session = await createSshSession(host);
        sendJson(response, 200, { sessionId: session.id });
      } catch (error) {
        respondError(response, error);
      }
    },
  ],
  [
    "POST /api/backend/sftp/list",
    async (request, response) => {
      try {
        const body = await readJson(request);
        const result = await listRemoteDirectory(body.host, body.path);
        sendJson(response, 200, result);
      } catch (error) {
        respondError(response, error);
      }
    },
  ],
  [
    "POST /api/backend/ssh-config/glob",
    async (request, response) => {
      try {
        const body = await readJson(request);
        const result = await globSshConfigFiles(body.pattern, body);
        sendJson(response, 200, result);
      } catch (error) {
        // A refused/outside-~/.ssh pattern is a 400, not a 500.
        if (error instanceof SshConfigResolutionFailure) {
          // Only these documented client fields cross the HTTP boundary; any
          // diagnostic properties added to the Error remain process-local.
          sendJson(response, error.statusCode, projectSshConfigResolutionFailure(error));
        } else {
          respondError(response, error, 400);
        }
      }
    },
  ],
  [
    "POST /api/backend/keys/inspect",
    async (request, response) => {
      try {
        const body = await readJson(request);
        const result = await inspectKey(body.path);
        sendJson(response, 200, result);
      } catch (error) {
        respondError(response, error);
      }
    },
  ],
  [
    "POST /api/backend/keys/generate",
    async (request, response) => {
      try {
        const body = await readJson(request);
        const result = await generateKeyPair(body);
        sendJson(response, 200, result);
      } catch (error) {
        respondError(response, error);
      }
    },
  ],
  [
    "POST /api/backend/keys/import-from-body",
    async (request, response) => {
      // T13: write pasted key body to disk with 0600 perms, then run
      // the same inspect path generateKeyPair uses on success.
      try {
        const body = await readJson(request);
        const result = await importPrivateKeyFromBody(body);
        sendJson(response, 200, result);
      } catch (error) {
        respondError(response, error);
      }
    },
  ],
  [
    "POST /api/backend/keys/copy-to-host",
    async (request, response) => {
      // T12: ssh-copy-id equivalent. Read .pub next to the private key,
      // open a one-shot SSH connection, append to authorized_keys.
      try {
        const body = await readJson(request);
        const result = await copyKeyToHostBackend(body);
        sendJson(response, 200, result);
      } catch (error) {
        respondError(response, error);
      }
    },
  ],
  [
    "POST /api/backend/known-hosts/scan",
    async (request, response) => {
      try {
        const body = await readJson(request);
        const entries = await scanKnownHost(body);
        sendJson(response, 200, { entries });
      } catch (error) {
        respondError(response, error);
      }
    },
  ],
  [
    "POST /api/backend/snippets/execute",
    async (request, response) => {
      try {
        const body = await readJson(request);
        const command = body.command?.trim();
        const targets = Array.isArray(body.targets) ? body.targets : [];

        if (!command) {
          sendJson(response, 400, { error: "Snippet command is required" });
          return;
        }

        if (!targets.length) {
          sendJson(response, 400, { error: "At least one target host is required" });
          return;
        }

        const results = await Promise.all(targets.map((target) => executeRemoteCommand(target, command)));
        sendJson(response, 200, { results });
      } catch (error) {
        respondError(response, error);
      }
    },
  ],
  [
    "GET /api/backend/forwards",
    async (request, response, url) => {
      const sessionId = url.searchParams.get("sessionId");
      const filtered = Array.from(forwards.values())
        .filter((forward) => !sessionId || forward.sessionId === sessionId)
        .map(serializeForward);
      sendJson(response, 200, { forwards: filtered });
    },
  ],
  [
    "POST /api/backend/forwards",
    async (request, response) => {
      try {
        const body = await readJson(request);
        const result =
          body.direction === "remote"
            ? await createRemoteForward(body)
            : await createLocalForward(body);
        sendJson(response, 200, result);
      } catch (error) {
        respondError(response, error);
      }
    },
  ],
  [
    "POST /api/backend/sftp/mkdir",
    async (request, response) => {
      try {
        const body = await readJson(request);
        const path = await createRemoteDirectory(body.host, body.path);
        sendJson(response, 200, { ok: true, path });
      } catch (error) {
        respondError(response, error);
      }
    },
  ],
  [
    "POST /api/backend/sftp/rename",
    async (request, response) => {
      try {
        const body = await readJson(request);
        const path = await renameRemoteEntry(body.host, body.currentPath, body.nextPath);
        sendJson(response, 200, { ok: true, path });
      } catch (error) {
        respondError(response, error);
      }
    },
  ],
  [
    "POST /api/backend/sftp/delete",
    async (request, response) => {
      try {
        const body = await readJson(request);
        await deleteRemoteEntry(body.host, body.path, body.isDirectory);
        sendJson(response, 200, { ok: true });
      } catch (error) {
        respondError(response, error);
      }
    },
  ],
  [
    "POST /api/backend/sftp/upload",
    async (request, response) => {
      try {
        // The upload body carries base64 file contents, so it gets a much larger
        // cap than the control-payload routes.
        const body = await readJson(request, SFTP_UPLOAD_MAX_BYTES);
        const path = await uploadRemoteFile(body.host, body.path, body.contentsBase64);
        sendJson(response, 200, { ok: true, path });
      } catch (error) {
        respondError(response, error);
      }
    },
  ],
  [
    "POST /api/backend/sftp/download",
    async (request, response) => {
      try {
        const body = await readJson(request);
        await sendRemoteFile(response, body.host, body.path);
      } catch (error) {
        if (!response.headersSent) {
          // Still recoverable — a hung stat times out here and surfaces as the
          // 504 the error carries, before any filename or byte is committed.
          respondError(response, error);
        } else {
          // #182: was response.end(). Once a Content-Length is committed, end()
          // asserts the response finished normally against a length the body will
          // never reach — a truncated file that looks complete to anything not
          // checking the framing. Destroying aborts the connection instead, so the
          // client's body read fails loudly.
          response.destroy();
        }
      }
    },
  ],
]);

const server = createServer(async (request, response) => {
  if (!request.url || !request.method) {
    response.writeHead(400);
    response.end("Bad request");
    return;
  }

  const url = new URL(request.url, "http://localhost");

  // #470: a preflight always fails, and it stays that way even if a CORS header
  // is ever added by mistake elsewhere. Same-origin clients never send one.
  if (request.method === "OPTIONS") {
    response.writeHead(405, { Allow: "GET, POST, DELETE" });
    response.end();
    return;
  }

  // Auth gate: reject every request whose Origin is not in the allowlist AND
  // does not present a valid per-launch token. See parity-and-hardening
  // review §3.S-4 / §3.S-8. Static asset paths are also gated — the browser
  // path serves the same dist that ships in production, but auth still
  // applies because the backend is local-only and the dist is already
  // bundled by Tauri in the native ship.
  const authDecision = isRequestAuthorized({
    headers: request.headers,
    allowedOrigins,
    expectedToken: backendAuth.token,
  });
  if (!authDecision.ok) {
    denyUnauthorized(response, authDecision);
    return;
  }
  // #473: connection code reads how this request was authorized (agent
  // forwarding needs the token). Applies to the rest of this request only.
  requestAuthContext.enterWith({ authorizedBy: authDecision.via });

  // A CORS preflight must always fail. The backend sends no
  // `Access-Control-Allow-*` header on any response, so a preflight that
  // reached this point would already be refused by the browser — but refusing
  // it explicitly means it keeps failing even if CORS headers are added by
  // mistake later. `readJson` refuses the simple content types a cross-origin
  // page can send without a preflight, so between the two a page the user
  // visits cannot reach the mutating routes.
  if (request.method === "OPTIONS") {
    response.writeHead(405, {
      "content-type": "application/json; charset=utf-8",
      allow: "GET, POST, DELETE",
    });
    response.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }

  // #470: an allowed Origin alone must not be enough. Checked here rather than
  // in readJson so no route's error handling can change the status and a new
  // route cannot forget it. The body is left unread.
  if (request.method === "POST" && !isJsonContentType(request.headers["content-type"])) {
    sendJson(response, 415, { error: "Content-Type must be application/json" });
    return;
  }

  const routeKey = `${request.method} ${url.pathname}`;
  const routeHandler = routes.get(routeKey);
  if (routeHandler) {
    await routeHandler(request, response, url);
    return;
  }

  const resizeMatch = url.pathname.match(/^\/api\/backend\/sessions\/([^/]+)\/resize$/);
  if (request.method === "POST" && resizeMatch) {
    const session = sessions.get(resizeMatch[1]);
    if (!session) {
      sendJson(response, 404, { error: "Session not found" });
      return;
    }

    try {
      const body = await readJson(request);
      if (!session.stream) {
        sendJson(response, 200, { ok: true, pending: true });
        return;
      }

      session.stream.setWindow(body.rows, body.cols, body.rows * 16, body.cols * 8);
      sendJson(response, 200, { ok: true });
    } catch (error) {
      respondError(response, error);
    }
    return;
  }

  const deleteMatch = url.pathname.match(/^\/api\/backend\/sessions\/([^/]+)$/);
  if (request.method === "DELETE" && deleteMatch) {
    const session = sessions.get(deleteMatch[1]);
    if (session) {
      await closeForwardsForSession(session.id);
      session.stream?.close();
      session.client.end();
      sessions.delete(session.id);
    }
    sendJson(response, 200, { ok: true });
    return;
  }

  const deleteForwardMatch = url.pathname.match(/^\/api\/backend\/forwards\/([^/]+)$/);
  if (request.method === "DELETE" && deleteForwardMatch) {
    try {
      await closeLocalForward(deleteForwardMatch[1]);
      sendJson(response, 200, { ok: true });
    } catch (error) {
      respondError(response, error);
    }
    return;
  }

  if (request.method === "GET") {
    await serveStatic(request, response);
    return;
  }

  response.writeHead(404);
  response.end("Not found");
});
const websocketServer = new WebSocketServer({ noServer: true });

server.on("upgrade", (request, socket, head) => {
  const url = new URL(request.url, "http://localhost");
  const match = url.pathname.match(/^\/ws\/sessions\/([^/]+)$/);

  if (!match) {
    socket.destroy();
    return;
  }

  // Same auth gate as the HTTP path. Browsers send Origin during the WS
  // upgrade; native callers must present the per-launch token. Sending an
  // explicit 401 line keeps debugging legible — `socket.destroy()` alone
  // would just look like a network error to the caller.
  const authDecision = isRequestAuthorized({
    headers: request.headers,
    allowedOrigins,
    expectedToken: backendAuth.token,
  });
  if (!authDecision.ok) {
    socket.write(
      `HTTP/1.1 401 Unauthorized\r\nContent-Type: text/plain\r\nContent-Length: ${authDecision.reason.length}\r\nConnection: close\r\n\r\n${authDecision.reason}`
    );
    socket.destroy();
    return;
  }

  const session = sessions.get(match[1]);
  if (!session) {
    socket.destroy();
    return;
  }

  websocketServer.handleUpgrade(request, socket, head, (ws) => {
    // Close any socket already attached to this session (a reconnect that
    // raced the old socket's close, or a second tab) before replacing it —
    // otherwise the previous ws is orphaned and only the last writer receives
    // output.
    if (session.ws && session.ws !== ws) {
      try {
        session.ws.close();
      } catch {
        // already closing
      }
    }
    session.ws = ws;
    ws.send(
      JSON.stringify({
        type: "status",
        state: session.state,
      })
    );
    // A failure that happened before this socket attached was never
    // broadcast to anyone, so it is replayed here.
    if (session.failureMessage) {
      ws.send(
        JSON.stringify({
          type: "error",
          message: session.failureMessage,
        })
      );
    }

    if (session.buffer.length || session.droppedBytes) {
      let data = session.buffer.join("");
      if (session.droppedBytes > 0) {
        // Tell the reconnecting client that older output was dropped rather
        // than silently presenting a gap in the scrollback.
        data = `\r\n[terminal-workspace: ${session.droppedBytes} bytes of earlier output were dropped while disconnected]\r\n${data}`;
      }
      ws.send(JSON.stringify({ type: "data", data }));
      session.buffer = [];
      session.bufferBytes = 0;
      session.droppedBytes = 0;
    }

    ws.on("message", (raw) => {
      // M06 / #88: defense-in-depth size guard. The per-launch token
      // gate already filters unauthenticated frames, but post-XSS or
      // a buggy client could still ship a multi-megabyte payload that
      // exhausts memory on JSON.parse. 64KB is more than enough for
      // input or resize messages. Drop oversized frames silently —
      // we don't want a buggy client to lose its session, just its
      // bad frame.
      if (raw.length > 65536) {
        return;
      }
      try {
        const message = JSON.parse(raw.toString("utf8"));
        if (message.type === "input" && session.stream) {
          session.stream.write(message.data);
        }
        if (message.type === "resize" && session.stream) {
          session.stream.setWindow(message.rows, message.cols, message.rows * 16, message.cols * 8);
        }
      } catch {
        // Ignore malformed websocket frames.
      }
    });

    ws.on("close", () => {
      if (session.ws === ws) {
        session.ws = null;
      }
    });
  });
});

// A single unhandled rejection or thrown error in one of the many detached
// async paths (ssh2 stream/forward handlers, ws message handlers) must not
// terminate the whole process and drop *every* session at once. Log it and
// keep serving the other sessions.
process.on("unhandledRejection", (reason) => {
  console.error("[termsnip] unhandled promise rejection:", reason);
});
process.on("uncaughtException", (error) => {
  console.error("[termsnip] uncaught exception (continuing):", error);
});

let shuttingDown = false;
// Set once this process has written its token file, and only then.
let publishedTokenPath = null;

function gracefulShutdown(signal) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  console.error(`[termsnip] received ${signal}; shutting down backend…`);
  shutdownBackend({
    server,
    websocketServer,
    sessions,
    forwards,
    // Only a file this process wrote: before listen() succeeds, the file at this
    // path (if any) belongs to another backend on the same port.
    sidecarPath: publishedTokenPath,
  });
  process.exit(0);
}
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));

// Registered before listen() so a port clash surfaces a clear message and a
// clean exit instead of an unhandled 'error' event stack trace. A server
// 'error' is a fatal bind failure, so ALWAYS exit(1) — rethrowing would be
// caught by the uncaughtException handler above and leave a zombie process with
// no bound port. EADDRINUSE gets a friendlier message than the fallback.
server.on("error", (error) => {
  const message =
    describeServerListenError(error, port) ??
    `backend server error: ${error?.message ?? error}`;
  console.error(`[termsnip] ${message}`);
  process.exit(1);
});

server.listen(port, "127.0.0.1", () => {
  // #474: published only now that this process owns the port, and named for
  // the port it actually bound, which differs from `port` when that is 0.
  const boundPort = server.address().port;
  try {
    publishedTokenPath = backendAuth.publish(boundPort);
  } catch (error) {
    console.error(`[termsnip] backend not started: could not write the token file: ${error.message}`);
    process.exit(1);
  }
  if (publishedTokenPath) {
    console.error(`[termsnip] backend token file: ${publishedTokenPath}`);
  }
  console.log(`Terminal Workspace backend listening on http://127.0.0.1:${boundPort}`);
});
