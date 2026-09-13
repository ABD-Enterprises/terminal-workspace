import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// #379: five files carry the app version and nothing kept them equal; the bundle,
// artifact names and latest.json follow tauri.conf.json, so a stale npm or Cargo
// version would ship silently mislabelled metadata.

const scriptPath = fileURLToPath(new URL("../../scripts/check-version-consistency.mjs", import.meta.url));

function repo(versions: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), "vc-"));
  mkdirSync(join(root, "apps/desktop"), { recursive: true });
  mkdirSync(join(root, "src-tauri"), { recursive: true });
  writeFileSync(join(root, "package.json"), JSON.stringify({ version: versions.root }));
  writeFileSync(join(root, "apps/desktop/package.json"), JSON.stringify({ version: versions.desktop }));
  writeFileSync(join(root, "src-tauri/tauri.conf.json"), JSON.stringify({ version: versions.tauri }));
  writeFileSync(join(root, "src-tauri/Cargo.toml"), `[package]\nname = "terminal-workspace"\nversion = "${versions.cargo}"\n\n[dependencies]\nfoo = "9.9.9"\n`);
  writeFileSync(join(root, "src-tauri/Cargo.lock"), `[[package]]\nname = "foo"\nversion = "9.9.9"\n\n[[package]]\nname = "terminal-workspace"\nversion = "${versions.lock}"\n`);
  return root;
}

function run(root: string, extra: string[] = []) {
  const r = spawnSync("node", [scriptPath, "--root", root, ...extra], { encoding: "utf8" });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

describe("check-version-consistency (#379)", () => {
  const all = { root: "0.2.0", desktop: "0.2.0", tauri: "0.2.0", cargo: "0.2.0", lock: "0.2.0" };

  it("passes when all five agree", () => {
    expect(run(repo(all)).code).toBe(0);
  });

  it("names the file that disagrees, using tauri.conf.json as canonical", () => {
    const r = run(repo({ ...all, cargo: "0.1.0" }));
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/src-tauri\/Cargo\.toml: 0\.1\.0/);
    const lock = run(repo({ ...all, lock: "0.1.0" }));
    expect(lock.code).toBe(1);
    expect(lock.out).toMatch(/Cargo\.lock \(terminal-workspace\): 0\.1\.0/);
  });

  it("can be told the expected version (release tag) explicitly", () => {
    expect(run(repo(all), ["--expect", "0.2.0"]).code).toBe(0);
    expect(run(repo(all), ["--expect", "0.3.0"]).code).toBe(1);
  });
});
