#!/usr/bin/env node
// #379: prove the updater feed is usable by an installed copy BEFORE it is
// published. Two things can silently produce a dead feed even when every file
// is present (#241 only checks presence):
//   1. the .sig was made with a private key that does not pair with the pubkey
//      compiled into the app (tauri.conf.json#plugins.updater.pubkey) — every
//      installed copy would then reject the update;
//   2. latest.json disagrees with the artifacts (wrong version, a signature that
//      is not the tarball's, a url naming a different file).
//
// Tauri's updater uses minisign. A .sig is:
//     untrusted comment: ...
//     base64( "ED" | key_id[8] | ed25519_sig[64] )
//     trusted comment: ...
//     base64( global_sig[64] )
// "ED" (prehashed) means the ed25519 signature is over BLAKE2b-512(file).
// The pubkey in tauri.conf.json is base64 of the whole minisign .pub file:
//     untrusted comment: ...
//     base64( "Ed" | key_id[8] | pk[32] )
// Node's crypto has both primitives, so no minisign binary is needed.
//
// Usage: verify-updater-signature.mjs --tarball <path> --sig <path> \
//          [--pubkey-b64 <b64> | --tauri-conf <path>] [--latest-json <path>] [--version <v>]
// Exit 0 when everything checks out; 1 with a reason otherwise.

import { createHash, createPublicKey, verify as cryptoVerify } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

function base64Line(text, label) {
  const line = text
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith("untrusted comment:") && !l.startsWith("trusted comment:"));
  if (!line) throw new Error(`${label}: no base64 payload line`);
  return Buffer.from(line, "base64");
}

export function parsePublicKey(pubkeyB64) {
  const fileText = Buffer.from(pubkeyB64, "base64").toString("utf8");
  const raw = base64Line(fileText, "public key");
  if (raw.length !== 42) throw new Error(`public key: expected 42 bytes, got ${raw.length}`);
  const alg = raw.subarray(0, 2).toString("latin1");
  if (alg !== "Ed") throw new Error(`public key: unexpected algorithm ${JSON.stringify(alg)}`);
  return { keyId: raw.subarray(2, 10), publicKey: raw.subarray(10, 42) };
}

export function parseSignature(sigText) {
  const raw = base64Line(sigText, "signature");
  if (raw.length !== 74) throw new Error(`signature: expected 74 bytes, got ${raw.length}`);
  const alg = raw.subarray(0, 2).toString("latin1");
  if (alg !== "ED") throw new Error(`signature: expected prehashed 'ED', got ${JSON.stringify(alg)}`);
  return { keyId: raw.subarray(2, 10), signature: raw.subarray(10, 74) };
}

/** Throws with a reason when the tarball's .sig was not made by the pubkey's key. */
export function verifyTarballSignature({ tarball, sigText, pubkeyB64 }) {
  const pub = parsePublicKey(pubkeyB64);
  const sig = parseSignature(sigText);
  if (!pub.keyId.equals(sig.keyId)) {
    throw new Error(
      `updater key mismatch: the signature was made with key id ${sig.keyId.toString("hex")} but the app trusts ${pub.keyId.toString("hex")} — installed copies would reject this update`
    );
  }
  const prehash = createHash("blake2b512").update(tarball).digest();
  const key = createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, pub.publicKey]), format: "der", type: "spki" });
  if (!cryptoVerify(null, prehash, key, sig.signature)) {
    throw new Error("updater signature does not verify against the app's pubkey (tampered tarball or wrong key)");
  }
}

/** Throws when latest.json does not describe exactly this tarball + signature. */
export function verifyLatestJson({ latestJsonText, sigText, tarballName, version }) {
  const feed = JSON.parse(latestJsonText);
  if (version && feed.version !== version) {
    throw new Error(`latest.json version ${JSON.stringify(feed.version)} != release version ${JSON.stringify(version)}`);
  }
  const platform = feed.platforms?.["darwin-aarch64"];
  if (!platform) throw new Error("latest.json has no platforms.darwin-aarch64 entry");
  if (platform.signature !== sigText.trim()) throw new Error("latest.json signature is not the tarball's .sig");
  if (!platform.url || basename(new URL(platform.url).pathname) !== tarballName) {
    throw new Error(`latest.json url ${JSON.stringify(platform.url)} does not name the tarball ${tarballName}`);
  }
}

function arg(name) {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : undefined;
}

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) {
  try {
    const tarballPath = arg("--tarball");
    const sigPath = arg("--sig") ?? `${tarballPath}.sig`;
    let pubkeyB64 = arg("--pubkey-b64");
    if (!pubkeyB64) {
      const conf = JSON.parse(readFileSync(arg("--tauri-conf") ?? "src-tauri/tauri.conf.json", "utf8"));
      pubkeyB64 = conf.plugins?.updater?.pubkey;
    }
    if (!tarballPath || !pubkeyB64) throw new Error("usage: --tarball <path> [--sig <path>] [--pubkey-b64 <b64> | --tauri-conf <path>] [--latest-json <path>] [--version <v>]");
    const sigText = readFileSync(sigPath, "utf8");
    verifyTarballSignature({ tarball: readFileSync(tarballPath), sigText, pubkeyB64 });
    const latestJson = arg("--latest-json");
    if (latestJson) {
      verifyLatestJson({ latestJsonText: readFileSync(latestJson, "utf8"), sigText, tarballName: basename(tarballPath), version: arg("--version") });
    }
    console.log(`[verify-updater-signature] ok: ${basename(tarballPath)} is signed by the key the app trusts${latestJson ? " and latest.json describes it" : ""}`);
  } catch (error) {
    console.error(`[verify-updater-signature] FAIL: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
