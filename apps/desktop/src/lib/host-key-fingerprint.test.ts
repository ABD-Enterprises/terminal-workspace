import { describe, expect, it } from "vitest";
import type { KeyRecord } from "../types/key";
import { resolveHostKeyFingerprintFrom } from "./host-key-fingerprint";

function makeKey(overrides: Partial<KeyRecord>): KeyRecord {
  return {
    id: "key-1",
    label: "Test Key",
    algorithm: "ED25519",
    bits: 256,
    fingerprint: "SHA256:abcdef",
    comment: "test@example",
    privateKeyPath: "~/.ssh/id_ed25519",
    publicKeyPath: "~/.ssh/id_ed25519.pub",
    source: "imported",
    hasPassphrase: true,
    assignedHostIds: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("resolveHostKeyFingerprintFrom", () => {
  it("returns the fingerprint for a host whose key path matches", () => {
    const hosts = [{ id: "h1", privateKeyPath: "~/.ssh/id_ed25519" }];
    const keys = [makeKey({})];
    expect(resolveHostKeyFingerprintFrom("h1", hosts, keys)).toBe("SHA256:abcdef");
  });

  it("trims whitespace before matching paths", () => {
    const hosts = [{ id: "h1", privateKeyPath: "  ~/.ssh/id_ed25519  " }];
    const keys = [makeKey({ privateKeyPath: "~/.ssh/id_ed25519" })];
    expect(resolveHostKeyFingerprintFrom("h1", hosts, keys)).toBe("SHA256:abcdef");
  });

  it("returns undefined when the host has no key path configured", () => {
    const hosts = [{ id: "h1", privateKeyPath: "" }];
    const keys = [makeKey({})];
    expect(resolveHostKeyFingerprintFrom("h1", hosts, keys)).toBeUndefined();
  });

  it("returns undefined when no key matches the host's path", () => {
    const hosts = [{ id: "h1", privateKeyPath: "~/.ssh/missing" }];
    const keys = [makeKey({ privateKeyPath: "~/.ssh/id_ed25519" })];
    expect(resolveHostKeyFingerprintFrom("h1", hosts, keys)).toBeUndefined();
  });

  it("returns undefined when the matching key has an empty fingerprint", () => {
    const hosts = [{ id: "h1", privateKeyPath: "~/.ssh/id_ed25519" }];
    const keys = [makeKey({ fingerprint: "" })];
    expect(resolveHostKeyFingerprintFrom("h1", hosts, keys)).toBeUndefined();
  });

  it("returns undefined when the matching key's fingerprint is missing the ALGO: prefix", () => {
    const hosts = [{ id: "h1", privateKeyPath: "~/.ssh/id_ed25519" }];
    const keys = [makeKey({ fingerprint: "abcdef" })];
    expect(resolveHostKeyFingerprintFrom("h1", hosts, keys)).toBeUndefined();
  });

  it("returns undefined for a host id that does not exist", () => {
    const hosts = [{ id: "h1", privateKeyPath: "~/.ssh/id_ed25519" }];
    const keys = [makeKey({})];
    expect(resolveHostKeyFingerprintFrom("missing", hosts, keys)).toBeUndefined();
  });

  it("two hosts sharing the same key path resolve to the same fingerprint", () => {
    // The whole point of the per-fingerprint Keychain entry: two hosts
    // using the same private key should hit the same Keychain account so
    // the user types the passphrase once.
    const hosts = [
      { id: "h1", privateKeyPath: "~/.ssh/deploy_key" },
      { id: "h2", privateKeyPath: "~/.ssh/deploy_key" },
    ];
    const keys = [makeKey({ privateKeyPath: "~/.ssh/deploy_key", fingerprint: "SHA256:shared" })];
    expect(resolveHostKeyFingerprintFrom("h1", hosts, keys)).toBe("SHA256:shared");
    expect(resolveHostKeyFingerprintFrom("h2", hosts, keys)).toBe("SHA256:shared");
  });
});
