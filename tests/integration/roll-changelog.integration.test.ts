// #427: roll-changelog rewrites and deletes release state, and the 0.2.0
// roll corrupted CHANGELOG.md once (9b8860e). Spawn the CLI against temp
// roots to pin the guard and the heading-anchor contracts.
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = new URL("../..", import.meta.url).pathname;
const SCRIPT = join(ROOT, "scripts/roll-changelog.mjs");

function fixture(fragment?: string) {
  const dir = mkdtempSync(join(tmpdir(), "roll-changelog-"));
  mkdirSync(join(dir, "scripts"));
  copyFileSync(SCRIPT, join(dir, "scripts/roll-changelog.mjs"));
  copyFileSync(join(ROOT, "CHANGELOG.md"), join(dir, "CHANGELOG.md"));
  if (fragment !== undefined) {
    mkdirSync(join(dir, "changelog.d"));
    writeFileSync(join(dir, "changelog.d", "f.md"), fragment);
  }
  return dir;
}

function run(dir: string, args: string[]) {
  try {
    execFileSync("node", [join(dir, "scripts/roll-changelog.mjs"), ...args], { cwd: dir, stdio: ["ignore", "ignore", "pipe"] });
    return 0;
  } catch (error) {
    return (error as { status?: number }).status ?? 1;
  }
}

describe("roll-changelog CLI", () => {
  it("exits 1 for a real roll and 0 for --dry-run when changelog.d is missing", () => {
    const dir = fixture();
    const before = readFileSync(join(dir, "CHANGELOG.md"), "utf8");
    expect(run(dir, ["1.0.0"])).toBe(1);
    expect(run(dir, ["1.0.0", "--dry-run"])).toBe(0);
    expect(readFileSync(join(dir, "CHANGELOG.md"), "utf8")).toBe(before);
  });

  it("exits 1 for a blank fragment without deleting it", () => {
    const dir = fixture("\n  \n");
    expect(run(dir, ["1.0.0"])).toBe(1);
    expect(() => readFileSync(join(dir, "changelog.d", "f.md"))).not.toThrow();
  });

  it("rolls a valid fragment and keeps the intro byte-identical", () => {
    const dir = fixture("- [FIX] from the test (#1)\n");
    const before = readFileSync(join(dir, "CHANGELOG.md"), "utf8");
    const intro = before.slice(0, before.indexOf("## Unreleased"));
    expect(run(dir, ["1.0.0", "--date", "2026-01-01"])).toBe(0);
    const after = readFileSync(join(dir, "CHANGELOG.md"), "utf8");
    expect(after.startsWith(intro)).toBe(true);
    expect(after).toContain("## 1.0.0 — 2026-01-01");
    expect(after).toContain("from the test (#1)");
  });
});
