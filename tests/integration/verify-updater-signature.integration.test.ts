import { createHash, generateKeyPairSync, randomBytes, sign as cryptoSign } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  verifyLatestJson,
  verifyTarballSignature,
} from "../../scripts/verify-updater-signature.mjs";

// #379: the updater gate used to check only that latest.json, the tarball and
// its .sig existed (#241). A .sig made with the wrong key, or a latest.json that
// describes a different file, still published cleanly — and every installed
// copy would then refuse the update. These tests build real minisign-format
// blobs from a key pair generated here, so the parser and the crypto are both
// exercised, not mocked.

function minisignPair() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const rawPk = publicKey.export({ format: "der", type: "spki" }).subarray(-32);
  const keyId = randomBytes(8);
  const pubFile = `untrusted comment: minisign public key: test\n${Buffer.concat([Buffer.from("Ed"), keyId, rawPk]).toString("base64")}\n`;
  const pubkeyB64 = Buffer.from(pubFile, "utf8").toString("base64");
  const signFile = (bytes: Buffer, id: Buffer = keyId) => {
    const prehash = createHash("blake2b512").update(bytes).digest();
    const sig = cryptoSign(null, prehash, privateKey);
    const globalSig = cryptoSign(null, Buffer.concat([sig, Buffer.from("trusted comment: t")]), privateKey);
    return `untrusted comment: signature from test key\n${Buffer.concat([Buffer.from("ED"), id, sig]).toString("base64")}\ntrusted comment: t\n${globalSig.toString("base64")}\n`;
  };
  return { pubkeyB64, keyId, signFile };
}

describe("verify-updater-signature (#379)", () => {
  const tarball = Buffer.from("not really a tarball but signed bytes");

  it("accepts a signature made with the key the app trusts", () => {
    const { pubkeyB64, signFile } = minisignPair();
    expect(() => verifyTarballSignature({ tarball, sigText: signFile(tarball), pubkeyB64 })).not.toThrow();
  });

  it("rejects a signature made with a different key (key id mismatch)", () => {
    const trusted = minisignPair();
    const other = minisignPair();
    expect(() => verifyTarballSignature({ tarball, sigText: other.signFile(tarball), pubkeyB64: trusted.pubkeyB64 })).toThrow(
      /updater key mismatch/
    );
  });

  it("rejects a forged key id with a wrong signature, and a tampered tarball", () => {
    const trusted = minisignPair();
    const other = minisignPair();
    // same key id, wrong private key: the crypto check must catch what the id check cannot
    expect(() => verifyTarballSignature({ tarball, sigText: other.signFile(tarball, trusted.keyId), pubkeyB64: trusted.pubkeyB64 })).toThrow(
      /does not verify/
    );
    const good = trusted.signFile(tarball);
    expect(() => verifyTarballSignature({ tarball: Buffer.concat([tarball, Buffer.from("x")]), sigText: good, pubkeyB64: trusted.pubkeyB64 })).toThrow(
      /does not verify/
    );
  });

  it("checks latest.json describes exactly this tarball, signature and version", () => {
    const { signFile } = minisignPair();
    const sigText = signFile(tarball);
    const good = JSON.stringify({
      version: "0.2.0",
      platforms: { "darwin-aarch64": { signature: sigText.trim(), url: "https://github.com/o/r/releases/latest/download/app-v0.2.0.app.tar.gz" } },
    });
    const base = { latestJsonText: good, sigText, tarballName: "app-v0.2.0.app.tar.gz", version: "0.2.0" };
    expect(() => verifyLatestJson(base)).not.toThrow();
    expect(() => verifyLatestJson({ ...base, version: "0.3.0" })).toThrow(/version/);
    expect(() => verifyLatestJson({ ...base, tarballName: "app-v0.1.0.app.tar.gz" })).toThrow(/does not name the tarball/);
    expect(() => verifyLatestJson({ ...base, sigText: signFile(Buffer.from("other")) })).toThrow(/not the tarball's/);
    expect(() => verifyLatestJson({ ...base, latestJsonText: JSON.stringify({ version: "0.2.0", platforms: {} }) })).toThrow(/darwin-aarch64/);
  });
});
