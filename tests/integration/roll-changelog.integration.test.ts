// #427: roll-changelog rewrites and deletes release state, and the 0.2.0
// roll corrupted CHANGELOG.md once (9b8860e). Spawn the CLI against temp
// roots to pin the guard, the heading anchor and the symlinked-invocation
// contracts.
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const SCRIPT = join(ROOT, "scripts/roll-changelog.mjs");
const HEADING = /^## Unreleased[ \t]*$/m;
// Prose above the real heading that mentions the marker: an anchor on the
// first substring would splice inside this line and lose the intro.
const INTRO = "See the `## Unreleased` section for pending lines.\n\n";

function fixture(fragment?: string) {
  const dir = mkdtempSync(join(tmpdir(), "roll-changelog-"));
  mkdirSync(join(dir, "scripts"));
  copyFileSync(SCRIPT, join(dir, "scripts/roll-changelog.mjs"));
  const changelog = join(dir, "CHANGELOG.md");
  copyFileSync(join(ROOT, "CHANGELOG.md"), changelog);
  const original = readFileSync(changelog, "utf8");
  const at = original.search(HEADING);
  if (at < 0) throw new Error("CHANGELOG.md has no '## Unreleased' heading");
  writeFileSync(changelog, original.slice(0, at) + INTRO + original.slice(at));
  if (fragment !== undefined) {
    mkdirSync(join(dir, "changelog.d"));
    writeFileSync(join(dir, "changelog.d", "f.md"), fragment);
  }
  return dir;
}

function run(dir: string, args: string[], script = join(dir, "scripts/roll-changelog.mjs")) {
  try {
    execFileSync("node", [script, ...args], { cwd: dir, stdio: ["ignore", "ignore", "pipe"] });
    return 0;
  } catch (error) {
    return (error as { status?: number }).status ?? 1;
  }
}

function introOf(changelog: string) {
  return changelog.slice(0, changelog.search(HEADING));
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
    const intro = introOf(before);
    // The marker is named in prose before the real heading, so an anchor on
    // the first substring would cut the intro in half.
    expect(intro).toContain("## Unreleased");
    expect(run(dir, ["1.0.0", "--date", "2026-01-01"])).toBe(0);
    const after = readFileSync(join(dir, "CHANGELOG.md"), "utf8");
    expect(after.startsWith(intro)).toBe(true);
    expect(after).toContain("## 1.0.0 — 2026-01-01");
    expect(after).toContain("from the test (#1)");
  });

  it("rolls when the script is invoked through a symlinked path", () => {
    const dir = fixture("- [FIX] from the symlink (#2)\n");
    symlinkSync(dir, join(dir, "link"));
    const linked = join(dir, "link/scripts/roll-changelog.mjs");
    expect(run(dir, ["1.0.0", "--date", "2026-01-01"], linked)).toBe(0);
    const after = readFileSync(join(dir, "CHANGELOG.md"), "utf8");
    expect(after).toContain("## 1.0.0 — 2026-01-01");
    expect(after).toContain("from the symlink (#2)");
    expect(existsSync(join(dir, "changelog.d", "f.md"))).toBe(false);
  });
});
