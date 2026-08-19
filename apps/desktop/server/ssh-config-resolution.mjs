import { createHash, randomBytes } from "node:crypto";
import os from "node:os";
import { dirname, join } from "node:path";

export const SSH_CONFIG_RESOLUTION_MAX_ENTRIES = 4096;

export class SshConfigResolutionFailure extends Error {
  constructor(path) {
    super("invalid SSH config resolution context");
    this.name = "SshConfigResolutionFailure";
    this.reason = "invalid-path";
    this.path = path;
    this.statusCode = 400;
  }

  toJSON() {
    return { reason: this.reason, path: this.path };
  }
}

export class SshConfigResolutionRegistry {
  #canonicalPaths = new Map();
  #maxEntries;
  #salt;

  constructor({ maxEntries = SSH_CONFIG_RESOLUTION_MAX_ENTRIES, salt = randomBytes(32) } = {}) {
    if (!Number.isSafeInteger(maxEntries) || maxEntries < 1) {
      throw new TypeError("SSH config resolution registry requires a positive entry limit");
    }
    this.#maxEntries = maxEntries;
    this.#salt = salt;
  }

  #cycleKey(canonicalPath) {
    return createHash("sha256")
      .update(this.#salt)
      .update("\0")
      .update(canonicalPath)
      .digest("hex");
  }

  remember(canonicalPath) {
    const cycleKey = this.#cycleKey(canonicalPath);
    if (this.#canonicalPaths.has(cycleKey)) {
      this.#canonicalPaths.delete(cycleKey);
    } else if (this.#canonicalPaths.size >= this.#maxEntries) {
      this.#canonicalPaths.delete(this.#canonicalPaths.keys().next().value);
    }
    this.#canonicalPaths.set(cycleKey, canonicalPath);
    return cycleKey;
  }

  canonicalPath(cycleKey) {
    const canonicalPath = this.#canonicalPaths.get(cycleKey);
    if (canonicalPath === undefined || this.#cycleKey(canonicalPath) !== cycleKey) {
      return undefined;
    }
    this.#canonicalPaths.delete(cycleKey);
    this.#canonicalPaths.set(cycleKey, canonicalPath);
    return canonicalPath;
  }
}

function expandHome(pathname) {
  return pathname?.startsWith("~/") ? join(os.homedir(), pathname.slice(2)) : pathname;
}

export function resolveSshConfigPath(requestedPath, context, sshRoot, resolutionRegistry) {
  const parentCycleKey = context?.parentCycleKey;
  const relativePath = context?.relativePath;
  const hasContext = parentCycleKey !== undefined || relativePath !== undefined;
  if (!hasContext) {
    return expandHome(requestedPath);
  }
  if (
    typeof parentCycleKey !== "string" ||
    typeof relativePath !== "string" ||
    relativePath.startsWith("/") ||
    relativePath.startsWith("~")
  ) {
    throw new SshConfigResolutionFailure(requestedPath);
  }

  const parentReal = resolutionRegistry.canonicalPath(parentCycleKey);
  const rootPrefix = sshRoot.endsWith("/") ? sshRoot : `${sshRoot}/`;
  if (
    parentReal === undefined ||
    (parentReal !== sshRoot && !parentReal.startsWith(rootPrefix))
  ) {
    throw new SshConfigResolutionFailure(requestedPath);
  }
  return join(dirname(parentReal), relativePath);
}
