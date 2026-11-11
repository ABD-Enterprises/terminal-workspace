import { posix as posixPath } from "node:path";
import { pipeline } from "node:stream/promises";
import {
  SFTP_DOWNLOAD_IDLE_TIMEOUT_MS,
  SFTP_DOWNLOAD_TOTAL_TIMEOUT_MS,
  SFTP_UPLOAD_TIMEOUT_MS,
} from "./backend-deadline.mjs";
import { resolveRemotePath, sanitizeFilename } from "./backend-paths.mjs";

const FILE_TYPE_MASK = 0o170000;
const DIRECTORY_TYPE = 0o040000;
const LINK_TYPE = 0o120000;

export function isDirectory(attrs, longname = "") {
  if (typeof attrs?.mode === "number") {
    return (attrs.mode & FILE_TYPE_MASK) === DIRECTORY_TYPE;
  }

  return longname.startsWith("d");
}

export function isLink(attrs, longname = "") {
  if (typeof attrs?.mode === "number") {
    return (attrs.mode & FILE_TYPE_MASK) === LINK_TYPE;
  }

  return longname.startsWith("l");
}

export function formatPermissions(mode) {
  if (typeof mode !== "number") {
    return undefined;
  }

  return (mode & 0o777).toString(8).padStart(3, "0");
}

export function toIsoTimestamp(unixSeconds) {
  if (typeof unixSeconds !== "number" || Number.isNaN(unixSeconds)) {
    return undefined;
  }

  return new Date(unixSeconds * 1000).toISOString();
}

export function createSftpOperations({ withSftp }) {
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
    // #182: a TOTAL budget, not idle — sftp.write's single callback exposes no
    // incremental progress to reset against. Sized for the request cap in
    // backend-deadline.mjs.
    return withSftp(host, { timeoutMs: SFTP_UPLOAD_TIMEOUT_MS }, async ({ sftp, onTimeout }) => {
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

      // Best-effort, never awaited: a timeout must not leave a file handle open
      // on the remote. Guarded so it cannot race the normal close below, and the
      // channel/transport teardown that follows is the real guarantee.
      let closeStarted = false;
      onTimeout(() => {
        if (closeStarted) {
          return;
        }
        closeStarted = true;
        sftp.close(handle, () => {});
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
        closeStarted = true;
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
    // #182: an IDLE deadline, so a large download that is slow but progressing is
    // not killed; only silence ends it.
    // #288: plus an absolute ceiling, because "not idle" is a bar a hostile or
    // broken peer clears by dripping one byte per interval forever. Idle bounds
    // silence; the ceiling bounds the transfer.
    await withSftp(
      host,
      {
        timeoutMs: SFTP_DOWNLOAD_IDLE_TIMEOUT_MS,
        totalTimeoutMs: SFTP_DOWNLOAD_TOTAL_TIMEOUT_MS,
      },
      async ({ sftp, onTimeout, resetDeadline }) => {
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
        resetDeadline();

        response.writeHead(200, {
          "Content-Disposition": `attachment; filename="${sanitizeFilename(posixPath.basename(targetPath))}"`,
          "Content-Length": String(fileStats.size ?? 0),
          "Content-Type": "application/octet-stream",
        });

        const readStream = sftp.createReadStream(targetPath);
        // Destroyed first so pipeline stops and the remote file handle starts
        // closing before the channel underneath it goes away.
        onTimeout(() => readStream.destroy());
        // Headers — including a Content-Length — are already committed, so the
        // status can no longer be replaced. DESTROY, never end(): end() asserts
        // the response completed normally against a length the body will not
        // reach, leaving the client to notice a framing violation and possibly
        // keeping the connection alive. Destroying aborts it, so the browser's
        // body read rejects and no truncated file reaches the save step.
        onTimeout(() => response.destroy());

        // What counts as progress. `data` is the remote supplying more body.
        // `drain` matters because pipeline pauses the SFTP readable while
        // response.write() applies backpressure — during that pause a slow but
        // alive HTTP consumer produces no `data` at all, and a data-only timer
        // would kill a healthy transfer.
        const onProgress = () => resetDeadline();
        readStream.on("open", onProgress);
        readStream.on("data", onProgress);
        response.on("drain", onProgress);

        try {
          await pipeline(readStream, response);
        } finally {
          readStream.off("open", onProgress);
          readStream.off("data", onProgress);
          response.off("drain", onProgress);
        }
      }
    );
  }

  return {
    listRemoteDirectory,
    createRemoteDirectory,
    renameRemoteEntry,
    deleteRemoteEntry,
    uploadRemoteFile,
    sendRemoteFile,
  };
}
