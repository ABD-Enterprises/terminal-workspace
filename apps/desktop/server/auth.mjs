// Backend authentication helpers extracted into a separate module so they can
// be unit-tested without standing up the full HTTP server. See:
// docs/parity-and-hardening-review.md §3.S-4 / §3.S-8 and
// docs/parity-and-hardening-plan.md P1-S4b.

import { randomBytes } from "node:crypto";
import { lstatSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Origins permitted to talk to the backend without presenting an auth token.
 * Browser fetch always sends Origin, so an allowlisted browser origin is
 * itself an authentication signal — the backend is bound to 127.0.0.1 and
 * a malicious page in another origin can only reach this list explicitly.
 *
 * Tauri's renderer reports `tauri://localhost` (or `http://tauri.localhost`
 * on some platforms). The dev vite proxy reports the renderer's origin
 * (typically `http://127.0.0.1:5173`).
 */
export const DEFAULT_ALLOWED_ORIGINS = Object.freeze([
  "http://127.0.0.1:5173",
  "http://localhost:5173",
  "tauri://localhost",
  "http://tauri.localhost",
]);

/** Header keys we accept the per-launch token under, lowercased. */
const TOKEN_HEADER_NAMES = Object.freeze([
  "x-termsnip-token",
  "authorization", // "Bearer <token>"
]);

/** Minimum acceptable token length, in characters. 32 hex chars = 128 bits. */
const MIN_TOKEN_LENGTH = 32;

/**
 * Parse a comma-separated env var value into a list of allowed origins. Empty
 * entries and whitespace are ignored. Returns the default list if the input
 * is empty/undefined.
 */
export function parseAllowedOrigins(value) {
  if (!value || typeof value !== "string") {
    return [...DEFAULT_ALLOWED_ORIGINS];
  }
  const parsed = value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return parsed.length ? parsed : [...DEFAULT_ALLOWED_ORIGINS];
}

/**
 * Extract a token value from a header map. Accepts both `X-Termsnip-Token`
 * and `Authorization: Bearer <token>` formats. Returns undefined if neither
 * is present or well-formed.
 *
 * The header map is the one Node's IncomingMessage exposes, where keys are
 * already lowercased.
 */
export function extractTokenFromHeaders(headers) {
  if (!headers || typeof headers !== "object") {
    return undefined;
  }
  for (const headerName of TOKEN_HEADER_NAMES) {
    const raw = headers[headerName];
    if (!raw) {
      continue;
    }
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (typeof value !== "string") {
      continue;
    }
    if (headerName === "authorization") {
      const match = value.match(/^Bearer\s+(\S+)$/i);
      if (match) {
        return match[1];
      }
      continue;
    }
    const trimmed = value.trim();
    if (trimmed) {
      return trimmed;
    }
  }
  return undefined;
}

/**
 * Constant-time-ish string comparison so a wrong token does not leak length
 * via timing. Both inputs must be strings; returns false if either is not a
 * string or lengths differ.
 *
 * (Node's `crypto.timingSafeEqual` exists but requires equal-length Buffers;
 * we wrap that contract here so callers do not have to coerce.)
 */
export function safeStringEquals(left, right) {
  if (typeof left !== "string" || typeof right !== "string") {
    return false;
  }
  if (left.length !== right.length) {
    return false;
  }
  let result = 0;
  for (let i = 0; i < left.length; i += 1) {
    result |= left.charCodeAt(i) ^ right.charCodeAt(i);
  }
  return result === 0;
}

/**
 * Decide whether to accept an incoming request based on its Origin header
 * and any token header it carries.
 *
 * Authorization rules (deny-by-default):
 *   1. If a valid `expectedToken` is configured AND the request supplies
 *      a matching token header, accept.
 *   2. Otherwise, if the request has an `Origin` header AND that origin is
 *      in `allowedOrigins`, accept.
 *   3. Otherwise, deny.
 *
 * Returning `{ ok: false, reason }` instead of throwing keeps the caller's
 * 403 response logic in one place.
 */
export function isRequestAuthorized({ headers, allowedOrigins, expectedToken }) {
  if (!headers || typeof headers !== "object") {
    return { ok: false, reason: "missing-headers" };
  }

  const candidateToken = extractTokenFromHeaders(headers);
  if (expectedToken && candidateToken && safeStringEquals(candidateToken, expectedToken)) {
    return { ok: true, via: "token" };
  }

  const rawOrigin = headers["origin"];
  const origin = Array.isArray(rawOrigin) ? rawOrigin[0] : rawOrigin;
  if (typeof origin === "string" && origin.length > 0) {
    if (Array.isArray(allowedOrigins) && allowedOrigins.includes(origin)) {
      return { ok: true, via: "origin" };
    }
    return { ok: false, reason: "origin-not-allowed" };
  }

  // No Origin header (e.g. native HTTP client like reqwest) and no/wrong
  // token. Deny.
  return { ok: false, reason: candidateToken ? "token-mismatch" : "no-credentials" };
}

/**
 * On startup, resolve the per-launch backend auth token:
 *   1. `TERMSNIP_BACKEND_TOKEN` env var (if non-empty and >= MIN_TOKEN_LENGTH).
 *      `publish()` writes nothing and returns null.
 *   2. Otherwise a fresh 32-byte random hex token. `publish(port)` writes it to
 *      `<stateDir>/backend/backend.<port>.token` with mode 0600, so a developer
 *      can call the backend by hand, and returns that path.
 *
 * The caller publishes only once it owns the port, and passes the port it
 * actually bound (not the requested one, which may be 0), so a launch that
 * fails to bind never replaces a running backend's file and two backends never
 * share one.
 *
 * #474: an existing file is never read back. The token used to live at a
 * predictable path in the temp directory and a pre-existing file there was
 * adopted, so any process able to write that path could choose the token.
 * Nothing in the app reads this file; it is written only for people.
 *
 * Throws, which stops startup, when the directory is not private; `publish()`
 * throws when the file cannot be created exclusively.
 */
export function loadOrCreateBackendToken({ env, stateDir }) {
  const fromEnv = env?.TERMSNIP_BACKEND_TOKEN?.trim();
  if (fromEnv && fromEnv.length >= MIN_TOKEN_LENGTH) {
    return { token: fromEnv, source: "env", publish: () => null };
  }

  const directory = join(stateDir, "backend");
  ensurePrivateDirectory(directory);
  const token = randomBytes(32).toString("hex");
  return {
    token,
    source: "generated",
    publish: (port) => {
      if (!Number.isInteger(port) || port <= 0) {
        throw new Error(`Cannot name a token file for port ${port}`);
      }
      const path = join(directory, `backend.${port}.token`);
      writeTokenFileExclusively(path, `${token}\n`);
      return path;
    },
  };
}

/**
 * Create `directory` as 0700 if missing; otherwise require that it is a real
 * directory (not a symlink), owned by this user, with no group or other access.
 * A creation mode does nothing for a directory that already exists, so an
 * existing one is checked rather than trusted. POSIX only: Windows has no
 * matching mode bits or uid.
 */
function ensurePrivateDirectory(directory) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const stats = lstatSync(directory);
  if (!stats.isDirectory()) {
    throw new Error(`Backend token directory is not a real directory: ${directory}`);
  }
  if (process.platform === "win32") {
    return;
  }
  if (typeof process.getuid === "function" && stats.uid !== process.getuid()) {
    throw new Error(`Backend token directory is owned by another user: ${directory}`);
  }
  if ((stats.mode & 0o077) !== 0) {
    throw new Error(
      `Backend token directory must not be readable by other users (chmod 700): ${directory}`
    );
  }
}

/**
 * Create the file with O_EXCL ("wx"), which never follows a symlink. A
 * leftover from a crashed launch, or a planted symlink, is unlinked (removing
 * the link itself, never its target) and creation is retried once.
 */
function writeTokenFileExclusively(path, contents) {
  try {
    writeFileSync(path, contents, { flag: "wx", mode: 0o600 });
    return;
  } catch (error) {
    if (error?.code !== "EEXIST") {
      throw error;
    }
  }
  unlinkSync(path);
  writeFileSync(path, contents, { flag: "wx", mode: 0o600 });
}

export const __testing = {
  MIN_TOKEN_LENGTH,
  TOKEN_HEADER_NAMES,
};
