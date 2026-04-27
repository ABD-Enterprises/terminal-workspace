import { describe, expect, it } from "vitest";

// The SecretBuffer module ships alongside the Node backend and is loaded via
// dynamic import so the test does not require a build step.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let secretsModule: any;

async function loadSecrets() {
  if (!secretsModule) {
    secretsModule = await import("../../apps/desktop/server/secrets.mjs");
  }
  return secretsModule;
}

describe("SecretBuffer", () => {
  it("round-trips a UTF-8 string through asString()", async () => {
    const { SecretBuffer } = await loadSecrets();
    const secret = SecretBuffer.fromString("p4ssw0rd•🔑");
    expect(secret.asString()).toBe("p4ssw0rd•🔑");
    expect(secret.length).toBe(Buffer.byteLength("p4ssw0rd•🔑", "utf8"));
    expect(secret.isScrubbed).toBe(false);
  });

  it("asBuffer() returns the underlying byte view", async () => {
    const { SecretBuffer } = await loadSecrets();
    const secret = SecretBuffer.fromString("hunter2");
    const buf = secret.asBuffer();
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.toString("utf8")).toBe("hunter2");
  });

  it("scrub() zero-fills the underlying buffer and marks the secret discarded", async () => {
    const { SecretBuffer } = await loadSecrets();
    const secret = SecretBuffer.fromString("hunter2");
    const aliasedBufferBeforeScrub = secret.asBuffer();
    expect(aliasedBufferBeforeScrub.toString("utf8")).toBe("hunter2");

    secret.scrub();

    expect(secret.isScrubbed).toBe(true);
    expect(secret.length).toBe(0);
    expect(secret.asString()).toBe("");
    expect(secret.asBuffer().length).toBe(0);
    // The aliased buffer obtained BEFORE scrub must now be all zeros — that
    // is the whole point of the wipe; ssh2 holding such a reference would
    // see a zeroed value too.
    expect(aliasedBufferBeforeScrub.every((byte) => byte === 0)).toBe(true);
  });

  it("scrub() is idempotent", async () => {
    const { SecretBuffer } = await loadSecrets();
    const secret = SecretBuffer.fromString("hunter2");
    secret.scrub();
    expect(() => secret.scrub()).not.toThrow();
    expect(secret.isScrubbed).toBe(true);
  });

  it("does not alias the caller's Buffer", async () => {
    const { SecretBuffer } = await loadSecrets();
    const original = Buffer.from("hunter2", "utf8");
    const secret = SecretBuffer.fromBuffer(original);
    secret.scrub();
    // Caller's Buffer must remain intact — wipe should affect only the
    // wrapper's internal copy.
    expect(original.toString("utf8")).toBe("hunter2");
  });

  it("treats null and undefined as empty without throwing", async () => {
    const { SecretBuffer } = await loadSecrets();
    expect(SecretBuffer.fromString(null).length).toBe(0);
    expect(SecretBuffer.fromString(undefined).length).toBe(0);
    expect(SecretBuffer.fromBuffer(null).length).toBe(0);
    expect(SecretBuffer.fromBuffer(undefined).length).toBe(0);
  });

  it("rejects non-string/non-Buffer inputs to the bare constructor", async () => {
    const { SecretBuffer } = await loadSecrets();
    expect(() => new SecretBuffer(123 as unknown as string)).toThrow(TypeError);
  });
});

describe("scrubSecretValue", () => {
  it("delegates to SecretBuffer.scrub for SecretBuffer inputs", async () => {
    const { SecretBuffer, scrubSecretValue } = await loadSecrets();
    const secret = SecretBuffer.fromString("hunter2");
    scrubSecretValue(secret);
    expect(secret.isScrubbed).toBe(true);
  });

  it("zero-fills raw Buffer inputs in place", async () => {
    const { scrubSecretValue } = await loadSecrets();
    const buf = Buffer.from("hunter2", "utf8");
    scrubSecretValue(buf);
    expect(buf.every((byte) => byte === 0)).toBe(true);
  });

  it("is a no-op for null, undefined, and unsupported types", async () => {
    const { scrubSecretValue } = await loadSecrets();
    expect(() => scrubSecretValue(null)).not.toThrow();
    expect(() => scrubSecretValue(undefined)).not.toThrow();
    // Strings cannot be scrubbed (V8 heap immutability) — wrapper docs say
    // these are silently ignored, not an error.
    expect(() => scrubSecretValue("hunter2")).not.toThrow();
  });
});
