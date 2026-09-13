#!/usr/bin/env node
// #379: the version that ends up in the bundle, Info.plist, artifact names
// and latest.json comes from src-tauri/tauri.conf.json; npm and Cargo carry
// their own copies and nothing kept them in step. Assert all five agree.
// Usage: check-version-consistency.mjs [--root DIR] [--expect <version>]
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export function readVersions(root) {
  const json = (p) => JSON.parse(readFileSync(join(root, p), "utf8")).version;
  const cargoToml = readFileSync(join(root, "src-tauri/Cargo.toml"), "utf8");
  const cargoLock = readFileSync(join(root, "src-tauri/Cargo.lock"), "utf8");
  const tomlVersion = cargoToml.match(/^\[package\][\s\S]*?^version\s*=\s*"([^"]+)"/m)?.[1];
  const lockVersion = cargoLock.match(/name = "terminal-workspace"\nversion = "([^"]+)"/)?.[1];
  return {
    "package.json": json("package.json"),
    "apps/desktop/package.json": json("apps/desktop/package.json"),
    "src-tauri/tauri.conf.json": json("src-tauri/tauri.conf.json"),
    "src-tauri/Cargo.toml": tomlVersion,
    "src-tauri/Cargo.lock (terminal-workspace)": lockVersion,
  };
}

export function findMismatch(versions, expect) {
  const canonical = expect ?? versions["src-tauri/tauri.conf.json"];
  const bad = Object.entries(versions).filter(([, v]) => v !== canonical);
  return bad.length ? { canonical, bad } : null;
}

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) {
  const rootFlag = process.argv.indexOf("--root");
  const root = rootFlag > -1 ? process.argv[rootFlag + 1] : join(fileURLToPath(new URL(".", import.meta.url)), "..");
  const expectFlag = process.argv.indexOf("--expect");
  const expect = expectFlag > -1 ? process.argv[expectFlag + 1] : undefined;
  const versions = readVersions(root);
  const mismatch = findMismatch(versions, expect);
  if (mismatch) {
    console.error(`[check-version-consistency] FAIL: expected ${mismatch.canonical} everywhere (from ${expect ? "--expect" : "src-tauri/tauri.conf.json"}), but:`);
    for (const [file, v] of mismatch.bad) console.error(`  ${file}: ${v ?? "(unreadable)"}`);
    process.exit(1);
  }
  console.log(`[check-version-consistency] ok: ${mismatch === null ? versions["src-tauri/tauri.conf.json"] : ""} in all five version sources`);
}
