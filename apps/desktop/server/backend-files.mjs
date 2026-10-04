// File helpers for the Node backend, factored out of backend.mjs so they can be
// unit-tested without the module binding a port on import.
//
// Both close a check-then-use race (CodeQL js/file-system-race): the property
// that was checked with a separate stat() is instead established on the same
// file descriptor that is then written or read.

import { constants } from "node:fs";
import { open } from "node:fs/promises";

export const PRIVATE_KEY_EXISTS_MESSAGE = "Target private key path already exists";

/**
 * Create `path` with `content` and mode 0600, refusing to touch anything that
 * already exists there.
 *
 * `wx` is O_CREAT|O_EXCL, so "does not exist" and "create it" are one syscall.
 * A stat() pre-check followed by a plain write would overwrite a key that
 * appeared in between — an existing private key is exactly the file this must
 * never clobber. Matches the Tauri backend's `create_new(true)` in
 * write_private_file (src-tauri/src/native_transport.rs).
 */
export async function writeNewPrivateFile(path, content) {
  let handle;
  try {
    handle = await open(path, "wx", 0o600);
  } catch (error) {
    if (error?.code === "EEXIST") {
      throw new Error(PRIVATE_KEY_EXISTS_MESSAGE, { cause: error });
    }
    throw error;
  }
  try {
    await handle.writeFile(content, "utf8");
  } finally {
    await handle.close();
  }
}

/**
 * Read `path` as UTF-8 if it is a regular file of at most `maxBytes`;
 * otherwise return undefined.
 *
 * The type and size checks run on the opened descriptor, so the bytes read are
 * from the file that was checked rather than whatever the path names by then.
 * O_NONBLOCK keeps open() from blocking on a FIFO (it has no effect on regular
 * files); the fstat then rejects it. The size is re-checked after the read
 * because a regular file can still grow while it is open.
 */
export async function readBoundedRegularFile(path, maxBytes) {
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NONBLOCK);
  } catch {
    return undefined;
  }
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > maxBytes) {
      return undefined;
    }
    const content = await handle.readFile();
    if (content.length > maxBytes) {
      return undefined;
    }
    return content.toString("utf8");
  } catch {
    return undefined;
  } finally {
    await handle.close();
  }
}
