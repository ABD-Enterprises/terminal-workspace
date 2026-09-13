import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// #319: the class guard. Three (then four) instances of "secret on argv" were
// each found by someone reading one call site; this test pins the scanner that
// finds the next one before merge, in all three languages the repo builds
// command lines in.

const scriptPath = fileURLToPath(new URL("../../scripts/secret-argv-check.mjs", import.meta.url));

function run(files: Record<string, string>): { code: number; out: string } {
  const root = mkdtempSync(join(tmpdir(), "secret-argv-"));
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(join(root, rel, ".."), { recursive: true });
    writeFileSync(join(root, rel), body);
  }
  const result = spawnSync("node", [scriptPath, "--root", root], { encoding: "utf8" });
  return { code: result.status ?? -1, out: `${result.stdout}${result.stderr}` };
}

describe("secret-argv-check (#319)", () => {
  it("passes an empty scan", () => {
    expect(run({ "scripts/noop.sh": "#!/bin/bash\necho hi\n" }).code).toBe(0);
  });

  it("flags a shell passphrase variable after ssh-keygen -N, but not a literal", () => {
    const bad = run({ "scripts/a.sh": 'ssh-keygen -t ed25519 -N "$PASSPHRASE" -f "$KEY"\n' });
    expect(bad.code).toBe(1);
    expect(bad.out).toMatch(/scripts\/a\.sh:1: `-N "\$PASSPHRASE"`/);
    expect(run({ "scripts/b.sh": 'ssh-keygen -t ed25519 -N "" -f "$KEY"\n' }).code).toBe(0);
  });

  it("flags gh secret set --body and --body=, and accepts --body-file", () => {
    expect(run({ "scripts/c.sh": 'gh secret set X --body "$VALUE"\n' }).code).toBe(1);
    expect(run({ "scripts/d.sh": "gh secret set X --body=$VALUE\n" }).code).toBe(1);
    expect(run({ "scripts/e.sh": 'gh secret set X --body-file "$F"\n' }).code).toBe(0);
  });

  it("flags a Rust vec! element and a .arg chain, and skips test modules", () => {
    const prod = [
      "fn go(pass: &str) {",
      '    let args = vec!["-t".to_string(), "ed25519".to_string(), "-N".to_string(), pass.to_string()];',
      "    run_ssh_keygen(&args);",
      "}",
    ].join("\n");
    const r = run({ "src-tauri/src/x.rs": prod });
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/x\.rs:2: `-N pass\.to_string\(\)`/);
    const chain = 'fn go(p: &str) { Command::new("/usr/bin/security").arg("add-generic-password").arg("-w").arg(p); }\n';
    expect(run({ "src-tauri/src/y.rs": chain }).code).toBe(1);
    const inTests = "fn ok() {}\n#[cfg(all(test, unix))]\nmod tests {\n" + prod + "\n}\n";
    expect(run({ "src-tauri/src/z.rs": inTests }).code).toBe(0);
  });

  it("does not fire on security -p as a policy name, only as create/unlock-keychain password", () => {
    expect(run({ "scripts/f.sh": "security find-identity -v -p codesigning\n" }).code).toBe(0);
    expect(run({ "scripts/g.sh": 'security create-keychain -p "$PW" "$KC"\n' }).code).toBe(1);
  });

  it("treats a trailing option (value via stdin) as safe", () => {
    const rs = 'fn w(v: &str) { run_security(&["add-generic-password", "-a", "x", "-w"], v); }\n';
    expect(run({ "src-tauri/src/w.rs": rs }).code).toBe(0);
  });

  it("honours secret-argv-ok and reports secret-argv-known as non-blocking", () => {
    expect(run({ "scripts/h.sh": '# secret-argv-ok: value is a public policy id\nssh-keygen -N "$NOT_A_SECRET" -f k\n' }).code).toBe(0);
    const allow = JSON.stringify([{ file: "scripts/i.sh", option: "--password", ticket: 378, expires: "2099-01-01" }]);
    const marker = 'xcrun notarytool submit --password "$PW" x.zip # secret-argv-known: #378\n';
    const known = run({ "scripts/i.sh": marker, "scripts/secret-argv-known.json": allow });
    expect(known.code).toBe(0);
    expect(known.out).toMatch(/known secret on argv .* tracked by #378/);
    // the marker alone is not an exemption — the reviewed allowlist entry is
    const unlisted = run({ "scripts/i.sh": marker });
    expect(unlisted.code).toBe(1);
    expect(unlisted.out).toMatch(/has no entry in scripts\/secret-argv-known\.json/);
    const expired = run({ "scripts/i.sh": marker, "scripts/secret-argv-known.json": allow.replace("2099-01-01", "2020-01-01") });
    expect(expired.code).toBe(1);
    expect(expired.out).toMatch(/expired 2020-01-01/);
  });

  it("catches cross-statement .arg/.push and glued option=value shapes (adversarial)", () => {
    const pushRs = [
      "fn go(pass: String) {",
      "    let mut args = Vec::new();",
      '    args.push("-N".to_string());',
      "    // comment between the statements",
      "",
      "    args.push(pass);",
      "    run_ssh_keygen(&args);",
      "}",
    ].join("\n");
    const push = run({ "src-tauri/src/p.rs": pushRs });
    expect(push.code).toBe(1);
    expect(push.out).toMatch(/p\.rs:3: `-N pass`/);
    const argRs = [
      "fn go(pw: &str) {",
      '    let mut c = Command::new("/usr/bin/security");',
      '    c.arg("create-keychain");',
      '    c.arg("-p");',
      "    c.arg(pw);",
      "}",
    ].join("\n");
    expect(run({ "src-tauri/src/q.rs": argRs }).code).toBe(1);
    const interleaved = [
      "fn go(pw: &str) {",
      '    let mut c = Command::new("/usr/bin/security");',
      '    c.arg("unlock-keychain");',
      '    c.arg("-p");',
      "    let attempts = 1;",
      "    log::debug!(\"unlocking {attempts}\");",
      "    c.arg(pw);",
      "}",
    ].join("\n");
    expect(run({ "src-tauri/src/s.rs": interleaved }).code).toBe(1);
    const fmtRs = 'fn go(p: &str) { let a = format!("--password={}", p); run_notarytool(&[a]); }\n';
    expect(run({ "src-tauri/src/r.rs": fmtRs }).code).toBe(1);
    const tpl = 'export function f(pw) { return execFile("gh", ["secret", "set", "X", `--body=${pw}`]); }\n';
    expect(run({ "scripts/t.mjs": tpl }).code).toBe(1);
    const concat = 'export function f(pw) { return spawn("ssh-keygen", ["-t", "ed25519", "-N" + pw]); }\n';
    expect(run({ "scripts/u.mjs": concat }).code).toBe(1);
  });
});
