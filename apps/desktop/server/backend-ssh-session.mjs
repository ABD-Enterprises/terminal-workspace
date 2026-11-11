import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Client } from "ssh2";
import {
  buildInteractiveShellCommand,
  getChannelEnvironment,
} from "./backend-shell.mjs";
import { requestAuthContext, sshAuthOptions } from "./backend-ssh-auth.mjs";
import { waitForSshReady } from "./backend-command-operations.mjs";
import { SecretBuffer } from "./secrets.mjs";
import { selectHostKeyVerifier } from "./backend-host-keys.mjs";
import { assertHostRequestIsAllowed } from "./backend-host-validation.mjs";

export function createSshSessionManager({
  sessions,
  getHostKeyStore,
  closeForwardsForSession,
  broadcast,
  failSession,
  expandHome,
}) {
  async function createConnectConfig(host) {
    // #473: every SSH connection (sessions, file transfer, remote commands,
    // each jump hop) is built here, so these rules cover them all. Checked
    // before anything else, so a refused request opens no connection.
    const authOptions = sshAuthOptions(host, {
      authorizedBy: requestAuthContext.getStore()?.authorizedBy,
      agentSocket: process.env.SSH_AUTH_SOCK,
    });

    // Defense-in-depth: even if a caller bypasses connections.ts (e.g. talks to
    // the backend HTTP API directly), refuse to connect when the host requires
    // a trusted key and we were not given one. See parity-and-hardening-review §3.S-1.
    if (host.hostKeyPolicy === "requireTrusted" && !host.knownHostPublicKey) {
      throw new Error(
        `Trusted host key required for ${host.hostname}:${host.port} but none was provided. Scan and trust the host first.`
      );
    }

    // The host record arrives in the request body, so the parts the backend must
    // not take on trust are checked before anything is done with it: an
    // unrecognised authMethod, and agent forwarding the backend was not
    // authorised to perform. See backend-host-validation.mjs.
    assertHostRequestIsAllowed(host);

    const connectConfig = {
      host: host.hostname,
      port: host.port,
      username: host.username,
      tryKeyboard: false,
      readyTimeout: 10000,
    };

    // Filled in by the verifier when it refuses the host, so the connect path
    // can report why instead of ssh2's bare "Host denied (verification failed)".
    let hostKeyFailure;
    // #489: an approved key decides alone; otherwise trust on first use
    // against the durable store (SEC-2). `hostVerifier` is NEVER left undefined:
    // ssh2's default accepts whatever answers the socket. The verifier runs
    // during the handshake, before authentication, so a refused host never
    // receives the password or the private key, and it fills in `failure` so
    // the connect path can report why.
    const verifier = selectHostKeyVerifier({ host, getStore: getHostKeyStore });
    connectConfig.hostVerifier = verifier.verify;
    hostKeyFailure = verifier.failure;

    Object.assign(connectConfig, authOptions);

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

    return { config: connectConfig, scrub: scrubBundle, hostKeyFailure };
  }

  async function openJumpSocket(host, setStage) {
    const jumpClient = await connectClient(host.jumpHost, setStage);

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

  async function connectClient(host, setStage) {
    setStage?.("configuration");
    const client = new Client();
    const { config: connectConfig, scrub, hostKeyFailure } = await createConnectConfig(host);
    setStage?.("connect");
    const jumpConnection = host.jumpHost ? await openJumpSocket(host, setStage) : undefined;

    if (jumpConnection?.socket) {
      connectConfig.sock = jumpConnection.socket;
    }

    try {
      return await waitForSshReady(
        client,
        connectConfig,
        jumpConnection?.jumpClient,
        setStage
      );
    } catch (error) {
      // A refused host key is reported with the reason, not ssh2's bare
      // "Host denied (verification failed)".
      if (hostKeyFailure.error) {
        throw hostKeyFailure.error;
      }
      throw error;
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
      bufferBytes: 0,
      droppedBytes: 0,
      // Set when the session fails, and replayed to a websocket that attaches
      // after the failure. See failSession.
      failureMessage: null,
    };
    // M05 / #87: connectClient (the short-lived path) properly destructures
    // both fields and runs scrub() in finally. createSshSession (the
    // long-lived path) previously discarded the scrub callback entirely —
    // password / passphrase / private-key bytes sat on the heap for the
    // session's whole lifetime. Capture both, scrub right after connect()
    // returns synchronously (ssh2 has consumed the secrets by then per the
    // contract documented in connectClient's finally block).
    const { config: connectConfig, scrub: scrubConfig, hostKeyFailure } =
      await createConnectConfig(host);
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
      // A refused host key is reported with the reason, not ssh2's bare
      // "Host denied (verification failed)".
      failSession(session, hostKeyFailure.error ?? error);
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

  return {
    createConnectConfig,
    openJumpSocket,
    connectClient,
    createSshSession,
  };
}
