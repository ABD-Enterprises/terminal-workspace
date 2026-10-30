// Durable trust-on-first-use store for the Node backend's SSH host keys.
//
// SEC-2 parity gap: the native transport (src-tauri/src/native_host_keys.rs)
// records a durable pin and refuses a later change. The Node backend used to
// install ssh2's `hostVerifier` only when the caller already supplied a known
// host key. With no key supplied, ssh2 took its default branch and accepted
// whatever answered the socket — and recorded nothing, so the host stayed
// unverifiable on every connect, forever. In browser mode that made every
// host whose policy is not `requireTrusted` MITM-able.
//
// This module is the Node side of that same store:
//
//   * the same OpenSSH-shaped file, `<app data dir>/ssh/known_hosts`, so a host
//     trusted in the native app is trusted in browser mode and vice versa;
//   * the same record shape, `host-pattern algorithm base64-key`, one per line;
//   * the same rules — the first sighting pins, a later change is a mismatch and
//     is refused, and a malformed store is an error rather than an empty map.
//
// Append-only, like the native store: a record is never rewritten or removed,
// so a pin another writer appended cannot be destroyed by our write.
//
// Concurrency. The native store takes an `flock` on a `known_hosts.lock`
// sidecar. Node has no `flock`, so this module uses its own exclusive-create
// lockfile (`known_hosts.lock.node`) to serialise Node instances against each
// other. The two protocols do not exclude one another — the same gap the
// native store already documents for the `ssh` binary, which cannot be made to
// take a lock either. What that leaves open is stated plainly: two writers
// meeting the SAME host for the first time can both decide "unknown" and
// append. Both appends are well-formed records, so the file stays readable;
// the risk is a store holding two different keys for one host, in which case
// the last one wins and a later verification reports a mismatch — the
// fail-closed direction.

import { chmod, lstat, mkdir, open, readFile, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/** The bundle identifier, so the browser backend and the native app agree. */
const APP_IDENTIFIER = "com.abdenterprises.terminalworkspace";

/** How long to wait for the lockfile before giving up and refusing to connect. */
const LOCK_TIMEOUT_MS = 5000;

/** How long to wait between attempts to take the lockfile. */
const LOCK_POLL_MS = 25;

export const HOST_KEY_VERDICT = Object.freeze({
  /** Nothing was pinned for this host; the presented key has been recorded. */
  PINNED: "pinned",
  /** The presented key matches what was pinned. */
  MATCHES: "matches",
  /** A different key is pinned. The caller MUST NOT authenticate. */
  MISMATCH: "mismatch",
});

/**
 * The OpenSSH `known_hosts` host pattern for a connection.
 *
 * Port 22 is written bare, anything else as `[host]:port`, because a bare
 * `host` in `known_hosts` means port 22 and nothing else. This mirrors the
 * Rust `known_hosts_host_pattern` exactly, so the two implementations read and
 * write the same records.
 */
export function knownHostsHostPattern(hostname, port) {
  const name = String(hostname ?? "").trim();
  if (!name) {
    throw new Error("cannot record a host key for a host with no hostname");
  }
  const number = Number(port);
  if (!Number.isInteger(number) || number < 1 || number > 65535) {
    throw new Error(`cannot record a host key for an invalid port: ${String(port)}`);
  }
  return number === 22 ? name : `[${name}]:${number}`;
}

/**
 * The algorithm name for a presented public key.
 *
 * An SSH public key blob begins with the algorithm name as a length-prefixed
 * string, so the name is read from the blob itself: `ssh-rsa`,
 * `ecdsa-sha2-nistp256`, `ssh-ed25519`, and so on. That is the same string
 * the native store records, which takes it from ssh2's key-type enum.
 *
 * A blob whose leading string cannot be read is refused rather than written
 * ambiguously — a record with an unknown algorithm would be a pin we could
 * not compare against later.
 */
export function hostKeyAlgorithmName(keyBlob) {
  if (!Buffer.isBuffer(keyBlob) || keyBlob.length < 4) {
    return null;
  }
  const length = keyBlob.readUInt32BE(0);
  if (length === 0 || length > keyBlob.length - 4) {
    return null;
  }
  const name = keyBlob.subarray(4, 4 + length).toString("utf8");
  return name.trim() ? name : null;
}

/**
 * The application data directory, mirroring Tauri's `app_data_dir()`.
 *
 * The native app resolves its store through Tauri, so it follows the bundle
 * identifier. The browser backend has no Tauri, so it resolves the same path
 * itself: the two modes then share one trust store rather than drifting into
 * two.
 *
 * `TERMSNIP_STATE_DIR` overrides it, which is what the tests use so they
 * never touch the developer's real store.
 */
export function resolveAppDataDirectory(env = process.env) {
  const override = String(env.TERMSNIP_STATE_DIR ?? "").trim();
  if (override) {
    return override;
  }
  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Application Support", APP_IDENTIFIER);
  }
  if (process.platform === "win32") {
    const appData = String(env.APPDATA ?? "").trim();
    return join(appData || join(homedir(), "AppData", "Roaming"), APP_IDENTIFIER);
  }
  const dataHome = String(env.XDG_DATA_HOME ?? "").trim();
  return join(dataHome || join(homedir(), ".local", "share"), APP_IDENTIFIER);
}

/** The durable `known_hosts` path: `<app data dir>/ssh/known_hosts`. */
export function resolveKnownHostsPath(env = process.env) {
  return join(resolveAppDataDirectory(env), "ssh", "known_hosts");
}

/**
 * The message a changed host key produces, matching the native transport's
 * wording so the two modes tell the user the same thing.
 */
export function hostKeyMismatchMessage(hostname, port) {
  return (
    `Host key verification failed for ${hostname}:${port}: the presented host key does not ` +
    "match the one first seen for this host. Credentials were not sent. This may indicate a " +
    "machine-in-the-middle attack, or the host may have been rebuilt — re-scan and explicitly " +
    "trust the replacement key before reconnecting."
  );
}

/**
 * The message an unverifiable host key produces: the store could not be read
 * or written, or the key was unusable.
 */
export function hostKeyVerificationFailureMessage(hostname, port, error) {
  return (
    `Could not verify the host key for ${hostname}:${port}: ${error?.message ?? error}. ` +
    "Credentials were not sent."
  );
}

/**
 * Build ssh2's `hostVerifier` for a host with no explicitly trusted key.
 *
 * The verifier runs during the handshake, before authentication, so a refused
 * host never receives the password or the private key.
 *
 * `failure` is filled in when the host is refused, so the connect path can
 * report why rather than ssh2's bare "Host denied (verification failed)".
 */
export function createHostKeyVerifier({ hostname, port, store }) {
  const failure = { message: null };

  const verify = (key, callback) => {
    store
      .verifyOrPin({ hostname, port, keyBlob: key })
      .then((result) => {
        if (result.verdict === HOST_KEY_VERDICT.MISMATCH) {
          failure.message = hostKeyMismatchMessage(hostname, port);
          callback(false);
          return;
        }
        callback(true);
      })
      .catch((error) => {
        // The store could not be read or written, or the key was unusable.
        // Refusing is the fail-closed direction: an unverifiable host must not
        // be authenticated against.
        failure.message = hostKeyVerificationFailureMessage(hostname, port, error);
        callback(false);
      });
  };

  return { verify, failure };
}

function sleep(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists and belongs to another user.
    return error?.code === "EPERM";
  }
}

/**
 * A durable `host-pattern -> (algorithm, base64 key)` map in OpenSSH
 * `known_hosts` shape.
 */
export function createHostKeyStore({ path = resolveKnownHostsPath(), lockPath } = {}) {
  const resolvedLockPath = lockPath ?? `${path}.lock.node`;

  /**
   * Read every record from the store.
   *
   * Fails closed: an unreadable or malformed store is an error, not an empty
   * map. Treating a damaged store as "nothing pinned" would re-pin whatever
   * answered the socket, which is the exact hole this closes.
   */
  async function load() {
    // A symlink or a directory here means something is manipulating trust
    // state, so it is refused rather than followed. The native store makes
    // the same check with `symlink_metadata`, and refuses a path that is not
    // a regular file.
    let stats;
    try {
      stats = await lstat(path);
    } catch (error) {
      if (error?.code === "ENOENT") {
        return new Map();
      }
      throw new Error(`could not read the SSH host-key store: ${error?.message ?? error}`, {
        cause: error,
      });
    }
    if (!stats.isFile()) {
      throw new Error(
        "the SSH host-key store is not a regular file; refusing to authenticate",
      );
    }

    let contents;
    try {
      contents = await readFile(path, "utf8");
    } catch (error) {
      throw new Error(`could not read the SSH host-key store: ${error?.message ?? error}`, {
        cause: error,
      });
    }

    const records = new Map();
    const lines = contents.split("\n");
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index].trim();
      if (!line || line.startsWith("#")) {
        continue;
      }
      const fields = line.split(/\s+/);
      if (fields.length < 3) {
        throw new Error(
          `the SSH host-key store at ${path} is malformed at line ${index + 1}; refusing to ` +
            "authenticate. Remove that line, or delete the file to re-pin from scratch, then " +
            "reconnect.",
        );
      }
      // Last record wins, so a host re-pinned later in the file is the one
      // that counts. This matches the native store's HashMap insert.
      records.set(fields[0], { algorithm: fields[1], key: fields[2] });
    }
    return records;
  }

  /**
   * Append one record. Never rewrites a line it did not author, so a pin that
   * another writer appended to this same file cannot be destroyed by our
   * write.
   */
  async function appendPin(pattern, algorithm, key) {
    const directory = dirname(path);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    // The directory holds trust state, so another local user must not be able
    // to add a pin to it. mkdir's mode is subject to the umask, so set it
    // explicitly.
    await chmod(directory, 0o700);

    // Only when the file exists and does not already end in a newline: a
    // previous writer that stopped mid-line must not have our record welded
    // onto the end of theirs.
    let needsSeparator = false;
    try {
      const existing = await readFile(path);
      needsSeparator = existing.length > 0 && existing[existing.length - 1] !== 0x0a;
    } catch (error) {
      if (error?.code !== "ENOENT") {
        throw new Error(`could not read the SSH host-key store: ${error?.message ?? error}`, {
          cause: error,
        });
      }
    }

    const body = `${needsSeparator ? "\n" : ""}${pattern} ${algorithm} ${key}\n`;

    // Re-check the path, not just the open descriptor: between the
    // regular-file check in load() and here, the path could have been
    // swapped for a symlink pointing somewhere else.
    try {
      const stats = await lstat(path);
      if (!stats.isFile()) {
        throw new Error(
          "the SSH host-key store is not a regular file; refusing to authenticate",
        );
      }
    } catch (error) {
      if (error?.code !== "ENOENT") {
        throw error;
      }
    }

    // Opened with "a" so the record is appended with a single O_APPEND write
    // rather than a rewrite: a rewrite would destroy a pin another writer
    // added, which is exactly what the native store refuses to do.
    const handle = await open(path, "a", 0o600);
    try {
      await handle.write(Buffer.from(body, "utf8"));
      await handle.sync();
    } finally {
      await handle.close();
    }
  }

  /**
   * Take the exclusive-create lockfile, returning the release callback.
   *
   * Blocking with a bounded wait rather than failing immediately: the critical
   * section is a small read and an append, so waiting is correct, and turning
   * contention into a failed connection would be a worse trade than a few
   * milliseconds of delay. If the lock cannot be taken in time, this throws —
   * the caller refuses to authenticate rather than proceeding unlocked.
   */
  async function acquireLock() {
    const deadline = Date.now() + LOCK_TIMEOUT_MS;
    await mkdir(dirname(resolvedLockPath), { recursive: true, mode: 0o700 });

    for (;;) {
      try {
        const handle = await open(resolvedLockPath, "wx", 0o600);
        await handle.write(Buffer.from(`${process.pid}\n`, "utf8"));
        await handle.close();
        return async () => {
          await rm(resolvedLockPath, { force: true });
        };
      } catch (error) {
        if (error?.code !== "EEXIST") {
          throw new Error(`could not take the SSH host-key lock: ${error?.message ?? error}`, {
            cause: error,
          });
        }
      }

      // The holder may have died without releasing the lock. A lock file whose
      // process is gone is stale and would otherwise wedge every later
      // connection.
      try {
        const holder = Number.parseInt(await readFile(resolvedLockPath, "utf8"), 10);
        if (!isProcessAlive(holder)) {
          await rm(resolvedLockPath, { force: true });
          continue;
        }
      } catch {
        // The lock file vanished between the EEXIST and this read; try again.
      }

      if (Date.now() >= deadline) {
        throw new Error(
          "the SSH host-key store is locked by another process; refusing to authenticate",
        );
      }
      await sleep(LOCK_POLL_MS);
    }
  }

  return {
    path,

    /**
     * Check the presented key for `hostname`/`port`, pinning it when nothing
     * is recorded.
     *
     * Throws rather than returning a verdict when the store cannot be read or
     * written. A caller that cannot verify must not authenticate.
     */
    async verifyOrPin({ hostname, port, keyBlob }) {
      const pattern = knownHostsHostPattern(hostname, port);
      const algorithm = hostKeyAlgorithmName(keyBlob);
      if (!algorithm) {
        throw new Error("SSH server presented an unusable host key");
      }
      const presented = Buffer.from(keyBlob).toString("base64");

      const release = await acquireLock();
      try {
        const records = await load();
        const existing = records.get(pattern);
        if (existing) {
          return existing.key === presented
            ? { verdict: HOST_KEY_VERDICT.MATCHES }
            : { verdict: HOST_KEY_VERDICT.MISMATCH, pinned: existing.key };
        }
        await appendPin(pattern, algorithm, presented);
        return { verdict: HOST_KEY_VERDICT.PINNED };
      } finally {
        await release();
      }
    },
  };
}
