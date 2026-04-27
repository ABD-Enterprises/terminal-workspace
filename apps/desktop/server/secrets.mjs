// Secret-handling helpers for the Node backend.
//
// Renderer-side requests carry plaintext SSH passwords and key passphrases as
// JSON strings. By the time we receive them, V8 has already allocated a
// String for each — we cannot rewrite those bytes after the fact (the V8
// heap interns/dedups strings and there is no public zero-fill API). Best
// we can do is:
//   1. Stop holding our own copy as a string the moment the secret is needed.
//   2. Wrap each secret in a Buffer that supports an explicit zero-fill scrub
//      so OUR copy is gone the moment ssh2 has consumed the value.
//   3. Document that ssh2's internal copy of `password` (string) and the
//      original JSON-parsed string both remain in V8 heap until GC.
// This is defense-in-depth, not a complete fix. See parity-and-hardening
// review §3.S-3 / plan P1-S3.
//
// The wrapper exposes only the access patterns we actually need from the
// connect path: `asBuffer()` for ssh2 passphrase parsing (Buffer is accepted
// by parseKey via bcrypt_pbkdf / md5.update), and `asString()` for the
// password slot (ssh2 explicitly requires `typeof === 'string'` there, so
// we have to materialise the string at call time and zero our Buffer once
// ssh2 has internalised it).

const ZERO_BUFFER = Buffer.alloc(0);

export class SecretBuffer {
  #buffer;
  #scrubbed = false;

  /** @param {string | Buffer | null | undefined} value */
  constructor(value) {
    if (value == null) {
      this.#buffer = Buffer.alloc(0);
      return;
    }
    if (Buffer.isBuffer(value)) {
      // Copy so the caller's Buffer is not aliased — that way scrub() does
      // not surprise an unrelated holder.
      this.#buffer = Buffer.from(value);
      return;
    }
    if (typeof value === "string") {
      this.#buffer = Buffer.from(value, "utf8");
      return;
    }
    throw new TypeError(
      `SecretBuffer requires a string, Buffer, null, or undefined; got ${typeof value}`
    );
  }

  /** @param {string | null | undefined} value */
  static fromString(value) {
    return new SecretBuffer(value ?? "");
  }

  /** @param {Buffer | null | undefined} value */
  static fromBuffer(value) {
    return new SecretBuffer(value ?? Buffer.alloc(0));
  }

  /** Length in bytes. Returns 0 after `scrub()`. */
  get length() {
    return this.#scrubbed ? 0 : this.#buffer.length;
  }

  get isScrubbed() {
    return this.#scrubbed;
  }

  /**
   * Returns a Buffer view callers can hand to crypto APIs (ssh2 parseKey
   * accepts Buffer for the passphrase slot). The returned buffer aliases the
   * internal storage; callers must not retain it past the next `scrub()`.
   * After scrub, returns an empty buffer rather than throwing so callers do
   * not have to special-case "secret already discarded".
   */
  asBuffer() {
    return this.#scrubbed ? ZERO_BUFFER : this.#buffer;
  }

  /**
   * Returns a UTF-8 string copy of the secret. Required for ssh2's password
   * field which only accepts strings. The returned string sits in V8's heap
   * and cannot be scrubbed; callers should pass it directly to ssh2 and not
   * stash it in a long-lived variable.
   */
  asString() {
    return this.#scrubbed ? "" : this.#buffer.toString("utf8");
  }

  /**
   * Best-effort wipe. Overwrites the underlying buffer with zeros and marks
   * the secret as discarded. Subsequent `asString()` / `asBuffer()` calls
   * return empty values. Idempotent.
   */
  scrub() {
    if (this.#scrubbed) {
      return;
    }
    this.#buffer.fill(0);
    this.#scrubbed = true;
  }
}

/**
 * Best-effort scrub of any secret-bearing reference. Accepts SecretBuffer
 * (preferred), raw Buffer, or null/undefined (no-op). Wrapped strings
 * cannot be scrubbed (V8 heap immutability) and are silently ignored — the
 * caller should switch to SecretBuffer if they want defense-in-depth.
 */
export function scrubSecretValue(value) {
  if (value == null) {
    return;
  }
  if (value instanceof SecretBuffer) {
    value.scrub();
    return;
  }
  if (Buffer.isBuffer(value)) {
    value.fill(0);
    return;
  }
  // Strings (and anything else) cannot be scrubbed in place.
}
