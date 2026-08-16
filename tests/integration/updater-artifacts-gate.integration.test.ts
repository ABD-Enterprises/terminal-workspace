import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// #241: a release must not publish without a working update feed. v0.1.0 did
// exactly that — promotion skipped the updater artifacts because the signing key
// was absent, publish uploaded the shorter asset list without complaint, and every
// installed copy's update check 404'd (#224). This exercises the guard that now
// stands between those two steps.

const scriptPath = fileURLToPath(
  new URL("../../scripts/verify-updater-artifacts.sh", import.meta.url),
);

function runGate(assets: string[]): { code: number; stderr: string; stdout: string } {
  try {
    const stdout = execFileSync("bash", [scriptPath, ...assets], { encoding: "utf8" });
    return { code: 0, stdout, stderr: "" };
  } catch (error) {
    const err = error as { status?: number; stderr?: string; stdout?: string };
    return { code: err.status ?? -1, stderr: err.stderr ?? "", stdout: err.stdout ?? "" };
  }
}

const COMPLETE = [
  "/promo/terminal-workspace-macos-v0.2.0.dmg",
  "/promo/latest.json",
  "/promo/terminal-workspace-macos-v0.2.0.app.tar.gz",
  "/promo/terminal-workspace-macos-v0.2.0.app.tar.gz.sig",
];

describe("verify-updater-artifacts", () => {
  it("accepts a release carrying the full updater triplet", () => {
    const { code, stdout } = runGate(COMPLETE);
    expect(code).toBe(0);
    expect(stdout).toContain("Updater artifacts present");
  });

  it("rejects the exact asset list v0.1.0 shipped, naming all three", () => {
    const { code, stderr } = runGate(["/promo/terminal-workspace-macos-v0.1.0.dmg"]);
    expect(code).toBe(1);
    expect(stderr).toContain("latest.json");
    expect(stderr).toContain("<app>.app.tar.gz");
    expect(stderr).toContain("<app>.app.tar.gz.sig");
  });

  it.each([
    ["latest.json", COMPLETE.filter((a) => !a.endsWith("/latest.json"))],
    ["<app>.app.tar.gz", COMPLETE.filter((a) => !a.endsWith(".app.tar.gz"))],
    ["<app>.app.tar.gz.sig", COMPLETE.filter((a) => !a.endsWith(".app.tar.gz.sig"))],
  ])("rejects a release missing %s", (label, assets) => {
    const { code, stderr } = runGate(assets);
    expect(code).toBe(1);
    expect(stderr).toContain(label);
  });

  it("does not accept the signature alone as the tarball", () => {
    // "foo.app.tar.gz.sig" ends with ".sig", not ".app.tar.gz" — a naive suffix
    // check that matched loosely would pass a release with no actual tarball.
    const { code, stderr } = runGate(["/promo/latest.json", "/promo/app.app.tar.gz.sig"]);
    expect(code).toBe(1);
    expect(stderr).toContain("<app>.app.tar.gz");
  });

  it("refuses an empty asset list rather than vacuously passing", () => {
    const { code, stderr } = runGate([]);
    expect(code).toBe(1);
    expect(stderr).toContain("no release assets");
  });

  it("is deterministic across repeated runs", () => {
    // The first implementation piped `printf | grep -q` under `set -o pipefail`.
    // grep exits at its first match, printf takes SIGPIPE, and pipefail reports
    // the pipeline as failed — so a present artifact was intermittently read as
    // missing. Repeat the passing case enough to catch a regression to that shape.
    const codes = new Set<number>();
    for (let i = 0; i < 25; i += 1) {
      codes.add(runGate(COMPLETE).code);
    }
    expect([...codes]).toEqual([0]);
  });
});

describe("verify-updater-artifacts filename precision", () => {
  it("does not accept a lookalike as the feed manifest", () => {
    // "not-latest.json" ends with "latest.json", so a suffix match would take it
    // while the real manifest was absent. Matched on basename instead.
    const { code, stderr } = runGate([
      "/promo/not-latest.json",
      "/promo/app.app.tar.gz",
      "/promo/app.app.tar.gz.sig",
    ]);
    expect(code).toBe(1);
    expect(stderr).toContain("latest.json");
  });
});
