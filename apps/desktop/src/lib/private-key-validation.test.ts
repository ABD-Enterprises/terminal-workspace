import { describe, expect, it } from "vitest";
import { validatePastedPrivateKey } from "./private-key-validation";

const privateKeyBoundary = (kind: string, boundary: "BEGIN" | "END") =>
  `-----${boundary} ${kind} PRIVATE KEY-----`;

const VALID_OPENSSH = `${privateKeyBoundary("OPENSSH", "BEGIN")}
b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZWQyNTUxOQAAACBJBgFakeFakeFakeFakeFakeFakeFakeFakeFake
${privateKeyBoundary("OPENSSH", "END")}`;

const VALID_RSA = `${privateKeyBoundary("RSA", "BEGIN")}
fakeBase64DataHere
${privateKeyBoundary("RSA", "END")}`;

describe("validatePastedPrivateKey", () => {
  it("accepts a well-formed OpenSSH private key", () => {
    expect(validatePastedPrivateKey(VALID_OPENSSH)).toEqual({ ok: true });
  });

  it("accepts a well-formed PKCS#1 RSA private key", () => {
    expect(validatePastedPrivateKey(VALID_RSA)).toEqual({ ok: true });
  });

  it("accepts when surrounded by trailing whitespace", () => {
    expect(validatePastedPrivateKey(`  \n\n${VALID_OPENSSH}\n\n  `)).toEqual({ ok: true });
  });

  it("rejects empty input", () => {
    expect(validatePastedPrivateKey("")).toMatchObject({ ok: false });
    expect(validatePastedPrivateKey("   \n\t  ")).toMatchObject({ ok: false });
  });

  it("rejects a plain password", () => {
    expect(validatePastedPrivateKey("hunter2")).toMatchObject({ ok: false });
  });

  it("rejects a public key (begins with ssh-ed25519/ssh-rsa)", () => {
    expect(validatePastedPrivateKey("ssh-ed25519 AAAA... user@host")).toMatchObject({
      ok: false,
    });
  });

  it("rejects a body missing the footer", () => {
    const noFooter = `${privateKeyBoundary("OPENSSH", "BEGIN")}\nbody-here-but-no-end`;
    expect(validatePastedPrivateKey(noFooter)).toMatchObject({ ok: false });
  });

  it("returns a human-readable reason for rejections", () => {
    const result = validatePastedPrivateKey("not a key");
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/PEM/);
  });
});
