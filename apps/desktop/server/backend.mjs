import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { mkdir, mkdtemp, readFile, rmdir, stat, unlink, writeFile } from "node:fs/promises";
import { connect as connectNet, createServer as createNetServer } from "node:net";
import { dirname, extname, join, normalize, posix as posixPath } from "node:path";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import os from "node:os";
import { Client } from "ssh2";
import { WebSocketServer } from "ws";
import {
  isRequestAuthorized,
  loadOrCreateBackendToken,
  parseAllowedOrigins,
} from "./auth.mjs";
import { SecretBuffer } from "./secrets.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const appRoot = normalize(join(__dirname, ".."));
const distRoot = join(appRoot, "dist");
const port = Number.parseInt(process.env.TERMSNIP_BACKEND_PORT ?? "8790", 10);

// Per-launch auth gate. The token is shared with the Tauri shell via env or a
// 0600 sidecar file in TMPDIR; browser callers are authenticated by a
// matching Origin header. See parity-and-hardening-review §3.S-4 / §3.S-8.
const backendAuth = loadOrCreateBackendToken({
  port,
  env: process.env,
  tmpdir: os.tmpdir(),
});
const allowedOrigins = parseAllowedOrigins(process.env.TERMSNIP_ALLOWED_ORIGINS);
console.error(
  `[termsnip] backend auth gate: token source=${backendAuth.source}, sidecar=${backendAuth.sidecarPath}`
);
console.error(`[termsnip] backend allowed origins: ${allowedOrigins.join(", ")}`);

function denyUnauthorized(response, decision) {
  response.writeHead(403, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify({ error: "Unauthorized", reason: decision.reason }));
}

// Single response shape for every catch-block in the HTTP handlers
// below. Audit pickup: the pattern
//   sendJson(response, 500, { error: getErrorMessage(error) })
// was duplicated 16 times in this file, which made the contract
// implicit and brittle (e.g. one site forgot the `error` key, would
// be hard to notice). Use this helper instead.
function respondError(response, error, status = 500) {
  sendJson(response, status, { error: getErrorMessage(error) });
}

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

const sessions = new Map();
const FILE_TYPE_MASK = 0o170000;
const DIRECTORY_TYPE = 0o040000;
const LINK_TYPE = 0o120000;
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

function normalizeRemotePath(pathname) {
  const normalized = pathname ? posixPath.normalize(pathname) : "/";
  return normalized.startsWith("/") ? normalized : `/${normalized}`;
}

function resolveRemotePath(rootPath = "/", pathname) {
  if (!pathname) {
    return normalizeRemotePath(rootPath);
  }

  if (pathname.startsWith("/")) {
    return normalizeRemotePath(pathname);
  }

  return normalizeRemotePath(posixPath.join(rootPath, pathname));
}

function isDirectory(attrs, longname = "") {
  if (typeof attrs?.mode === "number") {
    return (attrs.mode & FILE_TYPE_MASK) === DIRECTORY_TYPE;
  }

  return longname.startsWith("d");
}

function isLink(attrs, longname = "") {
  if (typeof attrs?.mode === "number") {
    return (attrs.mode & FILE_TYPE_MASK) === LINK_TYPE;
  }

  return longname.startsWith("l");
}

function formatPermissions(mode) {
  if (typeof mode !== "number") {
    return undefined;
  }

  return (mode & 0o777).toString(8).padStart(3, "0");
}

function toIsoTimestamp(unixSeconds) {
  if (typeof unixSeconds !== "number" || Number.isNaN(unixSeconds)) {
    return undefined;
  }

  return new Date(unixSeconds * 1000).toISOString();
}

function sanitizeFilename(value) {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_") || "download";
}

function getErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function getChannelEnvironment(environment) {
  if (!environment || typeof environment !== "object") {
    return undefined;
  }

  const entries = Object.entries(environment).filter(([key]) =>
    /^[A-Za-z_][A-Za-z0-9_]*$/.test(key)
  );
  if (!entries.length) {
    return undefined;
  }

  return Object.fromEntries(entries.map(([key, value]) => [key, String(value ?? "")]));
}

function escapeShellValue(value) {
  return `'${String(value ?? "").replace(/'/g, `'"'"'`)}'`;
}

function buildEnvironmentExportPrefix(environment) {
  const channelEnvironment = getChannelEnvironment(environment);

  if (!channelEnvironment) {
    return "";
  }

  return Object.entries(channelEnvironment)
    .map(([key, value]) => `export ${key}=${escapeShellValue(value)}`)
    .join("; ");
}

function buildInteractiveShellCommand(environment) {
  const exportPrefix = buildEnvironmentExportPrefix(environment);

  if (!exportPrefix) {
    return undefined;
  }

  return `${exportPrefix}; exec "${'${SHELL:-/bin/sh}'}" -l`;
}

function buildExecCommand(command, environment) {
  const exportPrefix = buildEnvironmentExportPrefix(environment);

  if (!exportPrefix) {
    return command;
  }

  return `${exportPrefix}; ${command}`;
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

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(body));
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function broadcast(session, message) {
  if (session.ws && session.ws.readyState === 1) {
    session.ws.send(JSON.stringify(message));
  } else if (message.type === "data") {
    session.buffer.push(message.data);
  }
}

function failSession(session, error) {
  session.state = "error";
  broadcast(session, {
    type: "error",
    message: getErrorMessage(error),
  });
}

async function createConnectConfig(host) {
  // Defense-in-depth: even if a caller bypasses connections.ts (e.g. talks to
  // the backend HTTP API directly), refuse to connect when the host requires
  // a trusted key and we were not given one. See parity-and-hardening-review §3.S-1.
  if (host.hostKeyPolicy === "requireTrusted" && !host.knownHostPublicKey) {
    throw new Error(
      `Trusted host key required for ${host.hostname}:${host.port} but none was provided. Scan and trust the host first.`
    );
  }

  const connectConfig = {
    host: host.hostname,
    port: host.port,
    username: host.username,
    tryKeyboard: false,
    readyTimeout: 10000,
  };

  if (host.knownHostPublicKey) {
    connectConfig.hostVerifier = (key) =>
      Buffer.isBuffer(key) && key.toString("base64") === host.knownHostPublicKey;
  }

  if (host.agentForwarding && process.env.SSH_AUTH_SOCK) {
    connectConfig.agent = process.env.SSH_AUTH_SOCK;
    connectConfig.agentForward = true;
  }

  // Secret-handling: wrap any password / passphrase / private-key bytes in a
  // SecretBuffer and remember a scrub callback for each. The caller is
  // responsible for invoking `scrub()` on the returned bundle after
  // ssh2's `client.connect()` has consumed the values (i.e. on both the
  // ready and error edges). See parity-and-hardening-review §3.S-3 / plan
  // P1-S3.
  const cleanups = [];
  const scrubBundle = () => {
    while (cleanups.length > 0) {
      const fn = cleanups.pop();
      try {
        fn();
      } catch {
        // Ignore — best-effort cleanup must not throw.
      }
    }
  };

  if (host.authMethod === "password") {
    // ssh2 only accepts a string for the password field (the implementation
    // explicitly checks `typeof === 'string'`). We keep our own copy as a
    // SecretBuffer; the string version is materialised here, lives on
    // connectConfig.password until scrub, and ssh2 will internalise its own
    // copy synchronously when client.connect() runs.
    const passwordSecret = SecretBuffer.fromString(host.password ?? "");
    connectConfig.password = passwordSecret.asString();
    cleanups.push(() => {
      passwordSecret.scrub();
      // Drop our reference to the materialised string so the V8 heap copy
      // becomes garbage-collectable (does not zero the V8 string itself).
      connectConfig.password = "";
    });
  } else if (host.authMethod === "privateKey") {
    // Read the private key as a Buffer (the default for fs.readFile without
    // an encoding) so we can fill it with zeros after ssh2 has parsed it.
    const keyBuffer = await readFile(expandHome(host.privateKeyPath));
    connectConfig.privateKey = keyBuffer;
    cleanups.push(() => {
      keyBuffer.fill(0);
      connectConfig.privateKey = Buffer.alloc(0);
    });

    if (host.passphrase) {
      // ssh2's parseKey accepts Buffer for the passphrase (used by
      // bcrypt_pbkdf and crypto.createHash().update()), so we can pass the
      // SecretBuffer's underlying Buffer directly.
      const passphraseSecret = SecretBuffer.fromString(host.passphrase);
      connectConfig.passphrase = passphraseSecret.asBuffer();
      cleanups.push(() => {
        passphraseSecret.scrub();
        connectConfig.passphrase = Buffer.alloc(0);
      });
    }
  }

  return { config: connectConfig, scrub: scrubBundle };
}

async function openJumpSocket(host) {
  const jumpClient = await connectClient(host.jumpHost);

  try {
    const socket = await new Promise((resolve, reject) => {
      jumpClient.forwardOut("127.0.0.1", 0, host.hostname, host.port, (error, stream) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(stream);
      });
    });

    return { jumpClient, socket };
  } catch (error) {
    jumpClient.end();
    throw error;
  }
}

async function connectClient(host) {
  const client = new Client();
  const { config: connectConfig, scrub } = await createConnectConfig(host);
  const jumpConnection = host.jumpHost ? await openJumpSocket(host) : undefined;

  if (jumpConnection?.socket) {
    connectConfig.sock = jumpConnection.socket;
  }

  try {
    return await new Promise((resolve, reject) => {
      client.on("ready", () => {
        if (jumpConnection?.jumpClient) {
          client.once("close", () => jumpConnection.jumpClient.end());
          client.once("error", () => jumpConnection.jumpClient.end());
        }
        resolve(client);
      });
      client.on("error", (error) => {
        jumpConnection?.jumpClient?.end();
        reject(error);
      });
      client.connect(connectConfig);
    });
  } finally {
    // Whether the SSH handshake succeeded or failed, ssh2 has already read
    // password / passphrase / private-key bytes off connectConfig (the
    // copies happen synchronously inside client.connect()). Wipe our
    // copies so they do not sit on the heap for the lifetime of the
    // session. ssh2 keeps its own internal copy of `password` (out of our
    // scrub reach) — see parity-and-hardening-review §3.S-3.
    scrub();
  }
}

async function withSftp(host, callback) {
  const client = await connectClient(host);

  try {
    const sftp = await new Promise((resolve, reject) => {
      client.sftp((error, sftpHandle) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(sftpHandle);
      });
    });

    return await callback({ client, sftp });
  } finally {
    client.end();
  }
}

async function createSshSession(host) {
  const session = {
    id: randomUUID(),
    host,
    client: new Client(),
    jumpClient: null,
    stream: null,
    ws: null,
    state: "connecting",
    buffer: [],
  };
  // M05 / #87: connectClient (the short-lived path) properly destructures
  // both fields and runs scrub() in finally. createSshSession (the
  // long-lived path) previously discarded the scrub callback entirely —
  // password / passphrase / private-key bytes sat on the heap for the
  // session's whole lifetime. Capture both, scrub right after connect()
  // returns synchronously (ssh2 has consumed the secrets by then per the
  // contract documented in connectClient's finally block).
  const { config: connectConfig, scrub: scrubConfig } = await createConnectConfig(host);
  const jumpConnection = host.jumpHost ? await openJumpSocket(host) : undefined;

  if (jumpConnection?.socket) {
    connectConfig.sock = jumpConnection.socket;
    session.jumpClient = jumpConnection.jumpClient;
  }

  session.client.on("ready", () => {
    const shellWindow = {
      term: "xterm-256color",
      cols: 120,
      rows: 36,
    };
    const shellEnvironment = getChannelEnvironment(host.environment);
    const interactiveShellCommand = buildInteractiveShellCommand(host.environment);
    const onShellReady = (error, stream) => {
      if (error) {
        failSession(session, error);
        return;
      }

      session.stream = stream;
      session.state = "connected";
      broadcast(session, {
        type: "status",
        state: "connected",
      });

      stream.on("data", (chunk) => {
        broadcast(session, {
          type: "data",
          data: chunk.toString("utf8"),
        });
      });

      stream.on("close", async () => {
        // M09 / #91: closeForwardsForSession used to run concurrently
        // with sessions.delete(session.id), which let forward
        // onConnection handlers reference a deleted sessionId and
        // error out. Await the forward cleanup BEFORE removing the
        // session from the map. The client.end() + jumpClient.end()
        // calls are idempotent; they can run regardless of state.
        session.state = "disconnected";
        broadcast(session, {
          type: "status",
          state: "disconnected",
        });
        try {
          await closeForwardsForSession(session.id);
        } finally {
          sessions.delete(session.id);
          session.client.end();
          session.jumpClient?.end();
        }
      });
    };

    if (interactiveShellCommand) {
      session.client.exec(
        interactiveShellCommand,
        shellEnvironment ? { env: shellEnvironment, pty: shellWindow } : { pty: shellWindow },
        onShellReady
      );
    } else if (shellEnvironment) {
      session.client.shell(shellWindow, { env: shellEnvironment }, onShellReady);
    } else {
      session.client.shell(shellWindow, onShellReady);
    }
  });

  session.client.on("error", (error) => {
    session.jumpClient?.end();
    failSession(session, error);
  });

  session.client.on("close", () => {
    if (session.state !== "disconnected") {
      session.state = "disconnected";
      broadcast(session, {
        type: "status",
        state: "disconnected",
      });
    }
    void closeForwardsForSession(session.id);
    session.jumpClient?.end();
  });

  try {
    session.client.connect(connectConfig);
  } finally {
    // ssh2 reads password / passphrase / privateKey synchronously inside
    // client.connect() (same contract connectClient relies on). Wipe our
    // copies so they do not sit on the heap for the session lifetime.
    scrubConfig();
  }
  sessions.set(session.id, session);
  return session;
}

async function listRemoteDirectory(host, pathname) {
  return withSftp(host, async ({ sftp }) => {
    const targetPath = resolveRemotePath(host.sftpRoot ?? "/", pathname);
    const entries = await new Promise((resolve, reject) => {
      sftp.readdir(targetPath, (error, list) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(list ?? []);
      });
    });

    return {
      path: targetPath,
      entries: entries
        .filter((entry) => entry.filename !== "." && entry.filename !== "..")
        .map((entry) => ({
          name: entry.filename,
          path: resolveRemotePath(targetPath, entry.filename),
          kind: isDirectory(entry.attrs, entry.longname) ? "directory" : "file",
          size: entry.attrs?.size ?? 0,
          permissions: formatPermissions(entry.attrs?.mode),
          modifiedAt: toIsoTimestamp(entry.attrs?.mtime),
          linked: isLink(entry.attrs, entry.longname),
        }))
        .sort((left, right) => {
          if (left.kind !== right.kind) {
            return left.kind === "directory" ? -1 : 1;
          }

          return left.name.localeCompare(right.name);
        }),
    };
  });
}

async function createRemoteDirectory(host, pathname) {
  return withSftp(host, async ({ sftp }) => {
    const targetPath = resolveRemotePath(host.sftpRoot ?? "/", pathname);

    await new Promise((resolve, reject) => {
      sftp.mkdir(targetPath, (error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });

    return targetPath;
  });
}

async function renameRemoteEntry(host, currentPath, nextPath) {
  return withSftp(host, async ({ sftp }) => {
    const sourcePath = resolveRemotePath(host.sftpRoot ?? "/", currentPath);
    const targetPath = resolveRemotePath(host.sftpRoot ?? "/", nextPath);

    await new Promise((resolve, reject) => {
      sftp.rename(sourcePath, targetPath, (error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });

    return targetPath;
  });
}

async function deleteRemoteEntry(host, pathname, isDirectoryEntry) {
  return withSftp(host, async ({ sftp }) => {
    const targetPath = resolveRemotePath(host.sftpRoot ?? "/", pathname);

    await new Promise((resolve, reject) => {
      const done = (error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      };

      if (isDirectoryEntry) {
        sftp.rmdir(targetPath, done);
      } else {
        sftp.unlink(targetPath, done);
      }
    });
  });
}

async function uploadRemoteFile(host, pathname, contentsBase64) {
  return withSftp(host, async ({ sftp }) => {
    const targetPath = resolveRemotePath(host.sftpRoot ?? "/", pathname);
    const buffer = Buffer.from(contentsBase64, "base64");
    const handle = await new Promise((resolve, reject) => {
      sftp.open(targetPath, "w", (error, nextHandle) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(nextHandle);
      });
    });

    try {
      await new Promise((resolve, reject) => {
        sftp.write(handle, buffer, 0, buffer.length, 0, (error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    } finally {
      await new Promise((resolve, reject) => {
        sftp.close(handle, (error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    }

    return targetPath;
  });
}

async function sendRemoteFile(response, host, pathname) {
  await withSftp(host, async ({ sftp }) => {
    const targetPath = resolveRemotePath(host.sftpRoot ?? "/", pathname);
    const fileStats = await new Promise((resolve, reject) => {
      sftp.stat(targetPath, (error, stats) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(stats);
      });
    });

    response.writeHead(200, {
      "Content-Disposition": `attachment; filename="${sanitizeFilename(posixPath.basename(targetPath))}"`,
      "Content-Length": String(fileStats.size ?? 0),
      "Content-Type": "application/octet-stream",
    });

    await pipeline(sftp.createReadStream(targetPath), response);
  });
}

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

// Quote a path for safe inclusion inside a /bin/sh single-quoted string.
// Mirrors shell_single_quote in src-tauri/src/native_transport.rs.
function shellSingleQuote(value) {
  return "'" + String(value).replace(/'/g, "'\\''") + "'";
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
  try {
    await stat(resolvedPath);
    throw new Error("Target private key path already exists");
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }
  // Normalize line endings + ensure a trailing newline (some keys
  // arrive without one and ssh-keygen rejects them).
  const normalized = body.replace(/\r\n?/g, "\n").replace(/\n*$/, "\n");
  await writeFile(resolvedPath, normalized, { mode: 0o600 });
  return inspectKey(resolvedPath);
}

/**
 * T12: install a public key on a remote host. Reads the .pub file
 * sitting next to the private key, opens a one-shot SSH connection
 * using the host's existing credentials, and appends to
 * authorized_keys with the canonical permission tighten-down.
 */
async function copyKeyToHostBackend({ privateKeyPath, host }) {
  if (!privateKeyPath || typeof privateKeyPath !== "string") {
    return { ok: false, reason: "A private key path is required." };
  }
  if (!host || !host.hostname) {
    return { ok: false, reason: "A target host is required." };
  }
  const pubPath = expandHome(`${privateKeyPath}.pub`);
  let pubBody;
  try {
    pubBody = (await readFile(pubPath, "utf8")).trim();
  } catch (error) {
    return {
      ok: false,
      reason: `Could not read public key at ${pubPath}: ${getErrorMessage(error)}`,
    };
  }
  if (pubBody.length === 0) {
    return { ok: false, reason: `Public key at ${pubPath} is empty.` };
  }
  // Shell-quote the pub body so a shell-special char in the comment
  // section can't break out. Single quotes don't allow embedded
  // single quotes, so we use the standard `'\''` escape.
  const quoted = `'${pubBody.replace(/'/g, "'\\''")}'`;
  const command =
    "mkdir -p ~/.ssh && chmod 700 ~/.ssh && " +
    `printf '%s\\n' ${quoted} >> ~/.ssh/authorized_keys && ` +
    "chmod 600 ~/.ssh/authorized_keys && echo OK";
  try {
    const result = await executeRemoteCommand({ id: host.hostname, label: host.hostname, host }, command);
    if (result.ok && result.stdout.trim().endsWith("OK")) {
      return { ok: true };
    }
    return {
      ok: false,
      reason: result.errorMessage ?? result.stderr.trim() ?? "Remote command failed.",
    };
  } catch (error) {
    return { ok: false, reason: getErrorMessage(error) };
  }
}

async function executeRemoteCommand(target, command) {
  try {
    const client = await connectClient(target.host);
    const channelEnvironment = getChannelEnvironment(target.host.environment);
    const execOptions = channelEnvironment
      ? { env: channelEnvironment }
      : undefined;
    const resolvedCommand = buildExecCommand(command, target.host.environment);

    try {
      return await new Promise((resolve) => {
        const handleExec = (error, stream) => {
          if (error) {
            resolve({
              targetId: target.id,
              label: target.label,
              ok: false,
              stdout: "",
              stderr: "",
              exitCode: null,
              errorMessage: getErrorMessage(error),
            });
            return;
          }

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
              errorMessage:
                code === 0
                  ? undefined
                  : stderr.trim() || `Command exited with code ${code ?? "unknown"}`,
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
  } catch (error) {
    return {
      targetId: target.id,
      label: target.label,
      ok: false,
      stdout: "",
      stderr: "",
      exitCode: null,
      errorMessage: getErrorMessage(error),
    };
  }
}

async function scanKnownHost({ hostname, port }) {
  const { stdout } = await execFileAsync("/usr/bin/ssh-keyscan", [
    "-p",
    String(port),
    "-T",
    "5",
    hostname,
  ]);

  const entries = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const [scannedHost, algorithm, publicKey] = line.split(/\s+/, 3);
      if (!scannedHost || !algorithm || !publicKey) {
        return undefined;
      }

      return {
        hostname,
        port,
        algorithm,
        publicKey,
        fingerprint: `SHA256:${createHash("sha256")
          .update(Buffer.from(publicKey, "base64"))
          .digest("base64")
          .replace(/=+$/, "")}`,
      };
    })
    .filter(Boolean);

  if (!entries.length) {
    throw new Error("No host keys returned from ssh-keyscan");
  }

  return entries;
}

async function serveStatic(request, response) {
  const requestedPath = new URL(request.url, "http://localhost").pathname;
  const normalizedPath = requestedPath === "/" ? "/index.html" : requestedPath;
  const targetPath = normalize(join(distRoot, normalizedPath));

  if (!targetPath.startsWith(distRoot)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  try {
    const fileStats = await stat(targetPath);
    if (fileStats.isDirectory()) {
      await serveStatic({ ...request, url: "/index.html" }, response);
      return;
    }

    const extension = extname(targetPath);
    response.writeHead(200, {
      "Content-Type": mimeTypes[extension] ?? "application/octet-stream",
    });
    createReadStream(targetPath).pipe(response);
  } catch {
    const indexPath = join(distRoot, "index.html");
    try {
      await stat(indexPath);
      response.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
      });
      createReadStream(indexPath).pipe(response);
    } catch {
      response.writeHead(404);
      response.end("Build output not found. Run pnpm --filter desktop build first.");
    }
  }
}

const server = createServer(async (request, response) => {
  if (!request.url || !request.method) {
    response.writeHead(400);
    response.end("Bad request");
    return;
  }

  const url = new URL(request.url, "http://localhost");

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

  if (request.method === "GET" && url.pathname === "/api/backend/status") {
    sendJson(response, 200, { ok: true });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/backend/sessions") {
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
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/backend/sftp/list") {
    try {
      const body = await readJson(request);
      const result = await listRemoteDirectory(body.host, body.path);
      sendJson(response, 200, result);
    } catch (error) {
      respondError(response, error);
    }
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/backend/keys/inspect") {
    try {
      const body = await readJson(request);
      const result = await inspectKey(body.path);
      sendJson(response, 200, result);
    } catch (error) {
      respondError(response, error);
    }
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/backend/keys/generate") {
    try {
      const body = await readJson(request);
      const result = await generateKeyPair(body);
      sendJson(response, 200, result);
    } catch (error) {
      respondError(response, error);
    }
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/backend/keys/import-from-body") {
    // T13: write pasted key body to disk with 0600 perms, then run
    // the same inspect path generateKeyPair uses on success.
    try {
      const body = await readJson(request);
      const result = await importPrivateKeyFromBody(body);
      sendJson(response, 200, result);
    } catch (error) {
      respondError(response, error);
    }
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/backend/keys/copy-to-host") {
    // T12: ssh-copy-id equivalent. Read .pub next to the private key,
    // open a one-shot SSH connection, append to authorized_keys.
    try {
      const body = await readJson(request);
      const result = await copyKeyToHostBackend(body);
      sendJson(response, 200, result);
    } catch (error) {
      respondError(response, error);
    }
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/backend/known-hosts/scan") {
    try {
      const body = await readJson(request);
      const entries = await scanKnownHost(body);
      sendJson(response, 200, { entries });
    } catch (error) {
      respondError(response, error);
    }
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/backend/snippets/execute") {
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
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/backend/forwards") {
    const sessionId = url.searchParams.get("sessionId");
    const filtered = Array.from(forwards.values())
      .filter((forward) => !sessionId || forward.sessionId === sessionId)
      .map(serializeForward);
    sendJson(response, 200, { forwards: filtered });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/backend/forwards") {
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
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/backend/sftp/mkdir") {
    try {
      const body = await readJson(request);
      const path = await createRemoteDirectory(body.host, body.path);
      sendJson(response, 200, { ok: true, path });
    } catch (error) {
      respondError(response, error);
    }
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/backend/sftp/rename") {
    try {
      const body = await readJson(request);
      const path = await renameRemoteEntry(body.host, body.currentPath, body.nextPath);
      sendJson(response, 200, { ok: true, path });
    } catch (error) {
      respondError(response, error);
    }
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/backend/sftp/delete") {
    try {
      const body = await readJson(request);
      await deleteRemoteEntry(body.host, body.path, body.isDirectory);
      sendJson(response, 200, { ok: true });
    } catch (error) {
      respondError(response, error);
    }
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/backend/sftp/upload") {
    try {
      const body = await readJson(request);
      const path = await uploadRemoteFile(body.host, body.path, body.contentsBase64);
      sendJson(response, 200, { ok: true, path });
    } catch (error) {
      respondError(response, error);
    }
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/backend/sftp/download") {
    try {
      const body = await readJson(request);
      await sendRemoteFile(response, body.host, body.path);
    } catch (error) {
      if (!response.headersSent) {
        respondError(response, error);
      } else {
        response.end();
      }
    }
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
    session.ws = ws;
    ws.send(
      JSON.stringify({
        type: "status",
        state: session.state,
      })
    );

    if (session.buffer.length) {
      ws.send(
        JSON.stringify({
          type: "data",
          data: session.buffer.join(""),
        })
      );
      session.buffer = [];
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

server.listen(port, "127.0.0.1", () => {
  console.log(`TermSnip backend listening on http://127.0.0.1:${port}`);
});
