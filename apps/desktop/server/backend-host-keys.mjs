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

import { constants } from "node:fs";
import { chmod, mkdir, open, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/** The bundle identifier, so the browser backend and the native app agree. */
const APP_IDENTIFIER = "com.abdenterprises.terminalworkspace";

/** How long to wait for the lockfile before giving up and refusing to connect. */
const LOCK_TIMEOUT_MS = 5000;

/** How long to wait between attempts to take the lockfile. */
const LOCK_POLL_MS = 25;

/**
 * How old a lockfile may be before it is treated as stale.
 *
 * The lock is released by removing the file, so a file that old belongs to a
 * process that died without releasing it — or to a PID that has since been
 * recycled, which would otherwise wedge every connection for as long as the
 * unrelated process lives.
 */
const LOCK_STALE_MS = 60000;

/** The store path is not a regular file. Refused rather than followed. */
class NotARegularFileError extends Error {}

export const HOST_KEY_VERDICT = Object.freeze({
  /** Nothing was pinned for this host; the presented key has been recorded. */
  PINNED: "pinned",
  /** The presented key matches what was pinned. */
  MATCHES: "matches",
  /** A different key is pinned. The caller MUST NOT authenticate. */
  MISMATCH: "mismatch",
});

/**
 * Characters that would let a hostname forge another record in the store.
 *
 * The store is a line-oriented file: one record per line, fields separated by
 * whitespace, and a line starting with `#` is a comment. A hostname carrying
 * a newline could therefore write a second record — forging a pin for another
 * host — or a malformed line that breaks the store for every host. Neither is
 * a legitimate hostname character.
 */
const UNSAFE_HOSTNAME_CHARACTERS = /[\s#]/;

/**
 * The OpenSSH `known_hosts` host pattern for a connection.
 *
 * Port 22 is written bare, anything else as `[host]:port`, because a bare
 * `host` in `known_hosts` means port 22 and nothing else. This mirrors the
 * Rust `known_hosts_host_pattern` exactly, so the two implementations read and
 * write the same records.
 *
 * A hostname that could break the record format is refused rather than
 * written. The store is shared with the native app, so a record written here
 * is trust the native app reads too.
 */
export function knownHostsHostPattern(hostname, port) {
  const name = String(hostname ?? "").trim();
  if (!name) {
    throw new Error("cannot record a host key for a host with no hostname");
  }
  if (UNSAFE_HOSTNAME_CHARACTERS.test(name)) {
    throw new Error(
      `cannot record a host key for ${JSON.stringify(name)}: a hostname may not contain whitespace or "#"`,
    );
  }
  const number = Number(port);
  if (!Number.isInteger(number) || number < 1 || number > 65535) {
    throw new Error(`cannot record a host key for an invalid port: ${String(port)}`);
  }
  return number === 22 ? name : `[${name}]:${number}`;
}

/**
 * A host label that is safe to put in front of a person.
 *
 * The refusal message reaches a terminal, which interprets escape sequences.
 * A hostname carrying one could forge terminal output on top of the real
 * error, so control characters are dropped before the message is built.
 */
function safeHostLabel(hostname, port) {
  // Drop the C0 control characters, DEL, and the C1 range (0x80-0x9F).
  // Written out rather than matched with a regular expression so the intent
  // is readable and the lint rule about control characters in patterns does
  // not apply. The C1 range matters: xterm.js reads U+009B as a CSI, so a
  // hostname carrying one could colour or clear the terminal over the real
  // error message.
  const name = Array.from(String(hostname ?? ""))
    .filter((character) => {
      const code = character.codePointAt(0) ?? 0;
      if (code < 0x20 || code === 0x7f) {
        return false;
      }
      if (code >= 0x80 && code <= 0x9f) {
        return false;
      }
      return true;
    })
    .join("");
  const number = Number(port);
  return Number.isInteger(number) ? `${name}:${number}` : name;
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
    `Host key verification failed for ${safeHostLabel(hostname, port)}: the presented host key ` +
    "does not match the one first seen for this host. Credentials were not sent. This may indicate " +
    "a machine-in-the-middle attack, or the host may have been rebuilt — re-scan and explicitly " +
    "trust the replacement key before reconnecting."
  );
}

/**
 * The message an unverifiable host key produces: the store could not be read
 * or written, or the key was unusable.
 */
export function hostKeyVerificationFailureMessage(hostname, port) {
  // Built from trusted data only. The underlying error — an `fs` failure
  // naming the store's absolute path, or a malformed-store message naming the
  // file and the line — stays on the server as the error's `cause` and is
  // never relayed. #230 is exactly about that class of text reaching a
  // client.
  return (
    `Could not verify the host key for ${safeHostLabel(hostname, port)}: the SSH host-key store ` +
    "could not be read or written, so the host was not authenticated. Credentials were not sent."
  );
}

/**
 * A host key that was refused.
 *
 * `respondError` rebuilds every client-facing message from trusted data and
 * never relays an arbitrary error message (#230). A refused host key is the
 * one failure whose reason the user needs — it is the difference between "the
 * host is unreachable" and "the key changed" — so it gets its own type, and
 * the message is built here from the host label and a fixed explanation.
 */
export class HostKeyRejectedError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "HostKeyRejectedError";
    // 403, not 500: the request was refused on purpose, and the caller did
    // nothing wrong that a retry would fix.
    this.statusCode = 403;
    // ssh2 reports a denied host key as a handshake-level error, and the
    // failure-stage mapping keys off that level. Keeping it means the
    // command path still classifies this as a host-key failure.
    this.level = "handshake";
  }
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
  const failure = { error: null };

  const verify = (key, callback) => {
    store
      .verifyOrPin({ hostname, port, keyBlob: key })
      .then((result) => {
        if (result.verdict === HOST_KEY_VERDICT.MISMATCH) {
          failure.error = new HostKeyRejectedError(hostKeyMismatchMessage(hostname, port));
          callback(false);
          return;
        }
        callback(true);
      })
      .catch((error) => {
        // The store could not be read or written, or the key was unusable.
        // Refusing is the fail-closed direction: an unverifiable host must not
        // be authenticated against.
        //
        // The cause carries the detail — which file, which line, which fs
        // error — for the in-process diagnostics channel. The message the
        // client sees is built from trusted data only.
        failure.error = new HostKeyRejectedError(
          hostKeyVerificationFailureMessage(hostname, port),
          { cause: error },
        );
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
export function createHostKeyStore({
  path = resolveKnownHostsPath(),
  lockPath,
  lockTimeoutMs = LOCK_TIMEOUT_MS,
} = {}) {
  const resolvedLockPath = lockPath ?? `${path}.lock.node`;

  /**
   * Read every record from the store.
   *
   * Fails closed: an unreadable or malformed store is an error, not an empty
   * map. Treating a damaged store as "nothing pinned" would re-pin whatever
   * answered the socket, which is the exact hole this closes.
   */
  async function load() {
    let contents;
    // Opened ONCE, with O_NOFOLLOW so a symlink at this path is refused
    // rather than followed, and everything after that goes through the
    // descriptor. A path-based check followed by a path-based read is a race:
    // the file can be replaced in between. The native store makes the same
    // check with `symlink_metadata` and then reads through the open handle.
    let handle;
    try {
      // O_NONBLOCK, because opening a FIFO for reading blocks until a writer
      // appears: a FIFO at this path would hang the connect instead of
      // refusing it. The `stat` below then refuses it as not a regular file,
      // which is the same answer the native store gives.
      handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    } catch (error) {
      if (error?.code === "ENOENT") {
        // A store that does not exist yet is the normal case: nothing has
        // been pinned. The first sighting creates it.
        return new Map();
      }
      if (error?.code === "ELOOP") {
        throw new NotARegularFileError(
          "the SSH host-key store is not a regular file; refusing to authenticate",
        );
      }
      throw new Error(`could not read the SSH host-key store: ${error?.message ?? error}`, {
        cause: error,
      });
    }

    try {
      const stats = await handle.stat();
      if (!stats.isFile()) {
        throw new NotARegularFileError(
          "the SSH host-key store is not a regular file; refusing to authenticate",
        );
      }

      // Read as bytes and decode strictly: the native store reads with
      // `read_to_string`, which errors on invalid UTF-8, and the two must
      // agree about whether the same file is valid. A lossy decode would
      // replace the bad bytes with U+FFFD and accept the file instead.
      const bytes = await handle.readFile();
      contents = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch (error) {
      if (error instanceof NotARegularFileError) {
        throw error;
      }
      throw new Error(`could not read the SSH host-key store: ${error?.message ?? error}`, {
        cause: error,
      });
    } finally {
      await handle.close();
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

    const body = `${pattern} ${algorithm} ${key}\n`;

    // Opened ONCE, with O_NOFOLLOW so a symlink at this path is refused
    // rather than followed, and the trailing-newline check and the append
    // both go through the same descriptor. A path-based check followed by a
    // path-based write is a race: the file can be replaced in between.
    //
    // O_APPEND means the record is written at the end of the file with a
    // single write, rather than a rewrite — a rewrite would destroy a pin
    // another writer added, which is exactly what the native store refuses
    // to do.
    let handle;
    try {
      handle = await open(
        path,
        constants.O_RDWR | constants.O_CREAT | constants.O_APPEND | constants.O_NOFOLLOW,
        0o600,
      );
    } catch (error) {
      if (error?.code === "ELOOP") {
        throw new NotARegularFileError(
          "the SSH host-key store is not a regular file; refusing to authenticate",
        );
      }
      throw new Error(`could not write the SSH host-key store: ${error?.message ?? error}`, {
        cause: error,
      });
    }

    try {
      const stats = await handle.stat();
      if (!stats.isFile()) {
        throw new NotARegularFileError(
          "the SSH host-key store is not a regular file; refusing to authenticate",
        );
      }

      // Only when the file exists and does not already end in a newline: a
      // previous writer that stopped mid-line must not have our record
      // welded onto the end of theirs.
      let needsSeparator = false;
      if (stats.size > 0) {
        const tail = Buffer.alloc(1);
        const { bytesRead } = await handle.read(tail, 0, 1, stats.size - 1);
        needsSeparator = bytesRead === 1 && tail[0] !== 0x0a;
      }

      await handle.write(Buffer.from(`${needsSeparator ? "\n" : ""}${body}`, "utf8"));
      await handle.sync();
    } catch (error) {
      if (error instanceof NotARegularFileError) {
        throw error;
      }
      throw new Error(`could not write the SSH host-key store: ${error?.message ?? error}`, {
        cause: error,
      });
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
    const deadline = Date.now() + lockTimeoutMs;
    await mkdir(dirname(resolvedLockPath), { recursive: true, mode: 0o700 });

    for (;;) {
      try {
        // `wx` is the exclusive create: the file is made only if it does not
        // exist, and `flush` writes the PID to disk before the handle closes.
        // It is done in one call rather than an open-then-write so that this
        // path is never checked and then used through the path — the file
        // could be replaced in between.
        //
        // The file is created empty and the PID written into it, so a reader
        // can catch it in the window before the write lands and see a
        // zero-length lock. That is safe: an unparsable lock counts as held
        // rather than stale, so a live lock is never taken out from under its
        // holder.
        await writeFile(resolvedLockPath, `${process.pid}\n`, {
          encoding: "utf8",
          flag: "wx",
          mode: 0o600,
          flush: true,
        });
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
      // connection. An unreadable or empty lock is treated as LIVE, not
      // stale: taking a lock whose holder is unknown would put two writers
      // in the critical section.
      try {
        // Opened once, and both the PID and the age are read through the
        // descriptor, so the check and the read cannot disagree about which
        // file they are talking about.
        //
        // O_NONBLOCK, because opening a FIFO for reading blocks until a
        // writer appears: a FIFO at this path would hang the connect rather
        // than refuse it. O_NOFOLLOW, because a symlink here would let
        // another local user point the lock at a file of their choosing.
        const handle = await open(
          resolvedLockPath,
          constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
        );
        let holder = Number.NaN;
        let age = 0;
        try {
          const stats = await handle.stat();
          if (stats.isFile()) {
            holder = Number.parseInt(await handle.readFile("utf8"), 10);
            age = Date.now() - stats.mtimeMs;
          }
          // A lock that is not a regular file — a FIFO, a device, a
          // directory — carries no PID and must not be read: a device would
          // never reach an end, and none of them is a lock we wrote. So
          // `holder` stays NaN and the lock counts as LIVE below. We cannot
          // prove it is stale, so we must not take it.
        } finally {
          await handle.close();
        }
        const stale = !Number.isInteger(holder) ? false : !isProcessAlive(holder) || age > LOCK_STALE_MS;
        if (stale) {
          await rm(resolvedLockPath, { force: true });
          continue;
        }
      } catch {
        // The lock file vanished between the EEXIST and this read, or it
        // cannot be read at all — a symlink, a directory, a file we may not
        // open. Either way we cannot tell whether its holder is alive, so we
        // must not take the lock; try again and let the deadline refuse.
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
