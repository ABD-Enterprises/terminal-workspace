import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { mkdir, readFile, stat } from "node:fs/promises";
import { connect as connectNet, createServer as createNetServer } from "node:net";
import { dirname, extname, join, normalize, posix as posixPath } from "node:path";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import os from "node:os";
import { Client } from "ssh2";
import { WebSocketServer } from "ws";

const __dirname = dirname(fileURLToPath(import.meta.url));
const appRoot = normalize(join(__dirname, ".."));
const distRoot = join(appRoot, "dist");
const port = Number.parseInt(process.env.TERMSNIP_BACKEND_PORT ?? "8790", 10);

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

  if (host.authMethod === "password") {
    connectConfig.password = host.password;
  } else if (host.authMethod === "privateKey") {
    connectConfig.privateKey = await readFile(expandHome(host.privateKeyPath), "utf8");
    if (host.passphrase) {
      connectConfig.passphrase = host.passphrase;
    }
  }

  return connectConfig;
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
  const connectConfig = await createConnectConfig(host);
  const jumpConnection = host.jumpHost ? await openJumpSocket(host) : undefined;

  if (jumpConnection?.socket) {
    connectConfig.sock = jumpConnection.socket;
  }

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
  const connectConfig = await createConnectConfig(host);
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

      stream.on("close", () => {
        session.state = "disconnected";
        broadcast(session, {
          type: "status",
          state: "disconnected",
        });
        void closeForwardsForSession(session.id);
        sessions.delete(session.id);
        session.client.end();
        session.jumpClient?.end();
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

  session.client.connect(connectConfig);
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

  const args = ["-q", "-t", type, "-f", resolvedPath, "-N", passphrase ?? "", "-C", comment];
  if (type === "rsa") {
    args.splice(3, 0, "-b", "4096");
  }
  if (type === "ecdsa") {
    args.splice(3, 0, "-b", "521");
  }

  await execFileAsync("/usr/bin/ssh-keygen", args);
  return inspectKey(resolvedPath);
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
      sendJson(response, 500, { error: getErrorMessage(error) });
    }
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/backend/sftp/list") {
    try {
      const body = await readJson(request);
      const result = await listRemoteDirectory(body.host, body.path);
      sendJson(response, 200, result);
    } catch (error) {
      sendJson(response, 500, { error: getErrorMessage(error) });
    }
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/backend/keys/inspect") {
    try {
      const body = await readJson(request);
      const result = await inspectKey(body.path);
      sendJson(response, 200, result);
    } catch (error) {
      sendJson(response, 500, { error: getErrorMessage(error) });
    }
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/backend/keys/generate") {
    try {
      const body = await readJson(request);
      const result = await generateKeyPair(body);
      sendJson(response, 200, result);
    } catch (error) {
      sendJson(response, 500, { error: getErrorMessage(error) });
    }
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/backend/known-hosts/scan") {
    try {
      const body = await readJson(request);
      const entries = await scanKnownHost(body);
      sendJson(response, 200, { entries });
    } catch (error) {
      sendJson(response, 500, { error: getErrorMessage(error) });
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
      sendJson(response, 500, { error: getErrorMessage(error) });
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
      sendJson(response, 500, { error: getErrorMessage(error) });
    }
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/backend/sftp/mkdir") {
    try {
      const body = await readJson(request);
      const path = await createRemoteDirectory(body.host, body.path);
      sendJson(response, 200, { ok: true, path });
    } catch (error) {
      sendJson(response, 500, { error: getErrorMessage(error) });
    }
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/backend/sftp/rename") {
    try {
      const body = await readJson(request);
      const path = await renameRemoteEntry(body.host, body.currentPath, body.nextPath);
      sendJson(response, 200, { ok: true, path });
    } catch (error) {
      sendJson(response, 500, { error: getErrorMessage(error) });
    }
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/backend/sftp/delete") {
    try {
      const body = await readJson(request);
      await deleteRemoteEntry(body.host, body.path, body.isDirectory);
      sendJson(response, 200, { ok: true });
    } catch (error) {
      sendJson(response, 500, { error: getErrorMessage(error) });
    }
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/backend/sftp/upload") {
    try {
      const body = await readJson(request);
      const path = await uploadRemoteFile(body.host, body.path, body.contentsBase64);
      sendJson(response, 200, { ok: true, path });
    } catch (error) {
      sendJson(response, 500, { error: getErrorMessage(error) });
    }
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/backend/sftp/download") {
    try {
      const body = await readJson(request);
      await sendRemoteFile(response, body.host, body.path);
    } catch (error) {
      if (!response.headersSent) {
        sendJson(response, 500, { error: getErrorMessage(error) });
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
      sendJson(response, 500, { error: getErrorMessage(error) });
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
      sendJson(response, 500, { error: getErrorMessage(error) });
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
