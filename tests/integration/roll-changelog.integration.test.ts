// #427: roll-changelog rewrites and deletes release state, and the 0.2.0
// roll corrupted CHANGELOG.md once (9b8860e). Spawn the CLI against temp
// roots to pin the guard, the heading anchor and the symlinked-invocation
// contracts.
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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

// Same spawn with stdout captured, for --dry-run previews.
function runOut(dir: string, args: string[]) {
  return execFileSync("node", [join(dir, "scripts/roll-changelog.mjs"), ...args], {
    cwd: dir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

// Splice a synthetic release section in directly under the Unreleased block,
// so a test controls the ledger's starting state for that version.
function addSection(dir: string, section: string) {
  const path = join(dir, "CHANGELOG.md");
  const text = readFileSync(path, "utf8");
  const at = text.search(/^## \d/m);
  if (at < 0) throw new Error("CHANGELOG.md has no release heading to splice before");
  writeFileSync(path, text.slice(0, at) + section + "\n" + text.slice(at));
}

// The one release section under an exact heading line, through the line
// before the next `## ` heading.
function sectionOf(changelog: string, heading: string) {
  const start = changelog.indexOf(heading);
  if (start < 0) throw new Error(`no section under ${JSON.stringify(heading)}`);
  const rest = changelog.slice(start);
  const next = rest.search(/\n## /);
  return next >= 0 ? rest.slice(0, next) : rest;
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
    // Everything from the first release heading down is what the insert path
    // must not touch: it survives byte-identical as the file's tail, with the
    // new section spliced in above it.
    const releases = before.slice(before.search(/^## \d/m));
    // The marker is named in prose before the real heading, so an anchor on
    // the first substring would cut the intro in half.
    expect(intro).toContain("## Unreleased");
    expect(run(dir, ["1.0.0", "--date", "2026-01-01"])).toBe(0);
    const after = readFileSync(join(dir, "CHANGELOG.md"), "utf8");
    expect(after.startsWith(intro)).toBe(true);
    expect(after.endsWith(releases)).toBe(true);
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

  // #446: a second roll of a version the ledger already holds used to insert a
  // second `## <version>` heading, splitting one release across two dates.

  it("merges into the section the ledger already holds instead of duplicating the heading", () => {
    const dir = fixture("- [FIX] merge-marker appended entry (#901)\n");
    const before = readFileSync(join(dir, "CHANGELOG.md"), "utf8");
    const intro = introOf(before);
    const heading = before.match(/^## 0\.2\.1 — .*$/m)?.[0];
    if (!heading) throw new Error("fixture ledger has no 0.2.1 section");
    const heldBefore = sectionOf(before, heading);
    const kept = heldBefore.split("\n").filter((line) => line.startsWith("- "));
    expect(kept.length).toBeGreaterThan(0);

    expect(run(dir, ["0.2.1", "--date", "2026-10-26"])).toBe(0);

    const after = readFileSync(join(dir, "CHANGELOG.md"), "utf8");
    expect(after.startsWith(intro)).toBe(true);
    // One heading for the release, under the original date.
    expect(after.match(/^## 0\.2\.1 — /gm)).toHaveLength(1);
    const held = sectionOf(after, heading);
    for (const entry of kept) expect(held).toContain(entry);
    expect(held).toContain("merge-marker appended entry (#901)");
    expect(existsSync(join(dir, "changelog.d", "f.md"))).toBe(false);
  });

  it("replaces a - None. placeholder instead of leaving it above the new entry", () => {
    const dir = fixture("- [FEATURE] merge-marker feature entry (#902)\n");
    addSection(dir, "## 9.9.9 — 2020-01-01\n\n### [FEATURE]\n\n- None.\n");
    expect(run(dir, ["9.9.9", "--date", "2026-10-26"])).toBe(0);
    const held = sectionOf(readFileSync(join(dir, "CHANGELOG.md"), "utf8"), "## 9.9.9 — 2020-01-01");
    expect(held).toContain("- merge-marker feature entry (#902)");
    expect(held).not.toContain("- None.");
    expect(held.match(/### \[FEATURE\]/g)).toHaveLength(1);
  });

  it("does not repeat an entry the section already holds byte-for-byte", () => {
    const dir = fixture("- [FIX] merge-marker duplicate entry (#903)\n");
    // The section holds the entry the way a roll renders it: `- text`, with
    // the label already spent on the block heading.
    addSection(dir, "## 9.9.9 — 2020-01-01\n\n### [FIX]\n\n- merge-marker duplicate entry (#903)\n");
    expect(run(dir, ["9.9.9", "--date", "2026-10-26"])).toBe(0);
    const after = readFileSync(join(dir, "CHANGELOG.md"), "utf8");
    // Still exactly one heading for the release: the roll merged, it did not
    // re-insert.
    expect(after.match(/^## 9\.9\.9 — /gm)).toHaveLength(1);
    const held = sectionOf(after, "## 9.9.9 — 2020-01-01");
    expect(held.match(/merge-marker duplicate entry \(#903\)/g)).toHaveLength(1);
  });

  it("creates a label block the section is missing at its place in the fixed order", () => {
    const dir = fixture("- [BREAKING] merge-marker breaking entry (#904)\n");
    addSection(
      dir,
      "## 9.9.9 — 2020-01-01\n\n### [FIX]\n\n- an existing fix (#1)\n\n### [SECURITY]\n\n- an existing security fix (#2)\n",
    );
    expect(run(dir, ["9.9.9", "--date", "2026-10-26"])).toBe(0);
    const held = sectionOf(readFileSync(join(dir, "CHANGELOG.md"), "utf8"), "## 9.9.9 — 2020-01-01");
    expect(held.indexOf("### [BREAKING]")).toBeGreaterThan(-1);
    expect(held.indexOf("### [BREAKING]")).toBeLessThan(held.indexOf("### [FIX]"));
    expect(held.indexOf("### [FIX]")).toBeLessThan(held.indexOf("### [SECURITY]"));
    expect(held).toContain("- merge-marker breaking entry (#904)");
    expect(held).toContain("- an existing fix (#1)");
    expect(held).toContain("- an existing security fix (#2)");
  });

  it("--dry-run previews the merged section and leaves the ledger untouched", () => {
    const dir = fixture("- [FIX] merge-marker dry-run entry (#905)\n");
    const path = join(dir, "CHANGELOG.md");
    const before = readFileSync(path, "utf8");
    const intro = introOf(before);
    const heading = before.match(/^## 0\.2\.1 — .*$/m)?.[0];
    if (!heading) throw new Error("fixture ledger has no 0.2.1 section");

    const preview = runOut(dir, ["0.2.1", "--date", "2026-10-26", "--dry-run"]);

    expect(preview.match(/^## 0\.2\.1 — /gm)).toHaveLength(1);
    // The ledger's own heading and date, not a fresh one for roll day.
    expect(preview).toContain(heading);
    expect(preview).toContain("merge-marker dry-run entry (#905)");
    expect(preview).not.toContain("## Unreleased");
    expect(readFileSync(path, "utf8")).toBe(before);
    expect(introOf(readFileSync(path, "utf8"))).toBe(intro);
    expect(existsSync(join(dir, "changelog.d", "f.md"))).toBe(true);
  });

  it("keeps prose and indented lines the ledger already holds in a merged section", () => {
    const dir = fixture("- [FIX] merge-marker prose entry (#907)\n");
    addSection(
      dir,
      "## 9.9.9 — 2020-01-01\n\nHand-written preamble.\n\n### [FIX]\n\n- an existing fix (#1)\n\n  a continuation line\n",
    );
    expect(run(dir, ["9.9.9", "--date", "2026-10-26"])).toBe(0);
    const held = sectionOf(readFileSync(join(dir, "CHANGELOG.md"), "utf8"), "## 9.9.9 — 2020-01-01");
    expect(held).toContain("Hand-written preamble.");
    expect(held).toContain("- an existing fix (#1)");
    expect(held).toContain("  a continuation line");
    expect(held).toContain("- merge-marker prose entry (#907)");
  });

  it("--dry-run previews exactly the section a real run writes", () => {
    const dir = fixture("- [FIX] merge-marker preview entry (#906)\n");
    const heading = readFileSync(join(dir, "CHANGELOG.md"), "utf8").match(/^## 0\.2\.1 — .*$/m)?.[0];
    if (!heading) throw new Error("fixture ledger has no 0.2.1 section");
    const preview = runOut(dir, ["0.2.1", "--date", "2026-10-26", "--dry-run"]);
    expect(run(dir, ["0.2.1", "--date", "2026-10-26"])).toBe(0);
    const after = readFileSync(join(dir, "CHANGELOG.md"), "utf8");
    const written = sectionOf(after, heading);
    expect(preview.trimEnd()).toBe(written.trimEnd());
    expect(preview).toContain("merge-marker preview entry (#906)");
  });

  it("--dry-run searches below Unreleased like the write, not the whole file", () => {
    const dir = fixture("- [FIX] merge-marker above entry (#908)\n");
    const path = join(dir, "CHANGELOG.md");
    // The version exists in both places: a held section below Unreleased —
    // the one the roll must merge into — and a stray copy above it, which
    // neither run may touch.
    addSection(dir, "## 9.9.9 — 2020-01-01\n\n### [FIX]\n\n- a held entry below (#7)\n");
    const text = readFileSync(path, "utf8");
    const at = text.search(HEADING);
    writeFileSync(path, `## 9.9.9 — 2000-01-01\n\n### [FIX]\n\n- an entry above (#1)\n\n${text.slice(at)}`);
    const before = readFileSync(path, "utf8");
    const head = before.slice(0, before.search(HEADING));

    const preview = runOut(dir, ["9.9.9", "--date", "2026-10-26", "--dry-run"]);

    // The held section below Unreleased is the one the preview merges —
    // its date, its entry, the new one folded in ...
    expect(preview).toContain("## 9.9.9 — 2020-01-01");
    expect(preview).toContain("a held entry below (#7)");
    expect(preview).toContain("merge-marker above entry (#908)");
    // ... and the copy above Unreleased is invisible to it.
    expect(preview).not.toContain("an entry above (#1)");
    expect(preview).not.toContain("2000-01-01");

    expect(run(dir, ["9.9.9", "--date", "2026-10-26"])).toBe(0);
    const after = readFileSync(path, "utf8");
    // Everything above ## Unreleased, the stray copy included, survives byte
    // for byte; below it, exactly one heading for the release.
    expect(after.startsWith(head)).toBe(true);
    const tail = after.slice(after.search(HEADING));
    expect(tail.match(/^## 9\.9\.9 — /gm)).toHaveLength(1);
    // Preview and write agree, section for section.
    expect(preview.trimEnd()).toBe(sectionOf(after, "## 9.9.9 — 2020-01-01").trimEnd());
  });

  it("--dry-run previews a fresh section for a version the ledger does not hold", () => {
    const dir = fixture("- [FIX] merge-marker fresh preview entry (#910)\n");
    const path = join(dir, "CHANGELOG.md");
    const before = readFileSync(path, "utf8");

    const preview = runOut(dir, ["7.7.7", "--date", "2026-10-26", "--dry-run"]);

    expect(preview).toContain("## 7.7.7 — 2026-10-26");
    expect(preview).toContain("### [FIX]");
    expect(preview).toContain("merge-marker fresh preview entry (#910)");
    // Still a preview: the ledger and the fragment are untouched.
    expect(readFileSync(path, "utf8")).toBe(before);
    expect(existsSync(join(dir, "changelog.d", "f.md"))).toBe(true);
  });

  it("heals a ledger that already holds two headings for the version", () => {
    const dir = fixture("- [FIX] merge-marker healing entry (#911)\n");
    // Splice the second section in first: addSection inserts before the
    // ledger's first release heading, so this lands the later copy above
    // 0.2.1 and the next call lands the earlier copy above that.
    addSection(dir, "## 9.9.9 — 2021-02-02\n\n### [FIX]\n\n- a later duplicate entry (#3)\n");
    addSection(dir, "## 9.9.9 — 2020-01-01\n\n### [FIX]\n\n- an earlier duplicate entry (#4)\n");

    expect(run(dir, ["9.9.9", "--date", "2026-10-26"])).toBe(0);

    const after = readFileSync(join(dir, "CHANGELOG.md"), "utf8");
    // One heading left, under the first section's date.
    expect(after.match(/^## 9\.9\.9 — /gm)).toHaveLength(1);
    expect(after).toContain("## 9.9.9 — 2020-01-01");
    expect(after).not.toContain("2021-02-02");
    // Both duplicates' entries and the new one live in the healed section,
    // and the rest of the ledger below it is intact.
    const held = sectionOf(after, "## 9.9.9 — 2020-01-01");
    expect(held).toContain("- an earlier duplicate entry (#4)");
    expect(held).toContain("- a later duplicate entry (#3)");
    expect(held).toContain("- merge-marker healing entry (#911)");
    expect(after).toContain("## 0.2.1 — ");
  });

  it("keeps a non-label subheading as its own block and interior blank lines in place", () => {
    const dir = fixture("- [FIX] merge-marker subheading entry (#912)\n");
    addSection(
      dir,
      "## 9.9.9 — 2020-01-01\n\n### [FIX]\n\n- existing fix one (#1)\n\n- existing fix two (#2)\n\n### Notes\n\n- a hand note\n",
    );

    expect(run(dir, ["9.9.9", "--date", "2026-10-26"])).toBe(0);

    const after = readFileSync(join(dir, "CHANGELOG.md"), "utf8");
    expect(after.match(/^## 9\.9\.9 — /gm)).toHaveLength(1);
    const held = sectionOf(after, "## 9.9.9 — 2020-01-01");
    // The blank line between the ledger's own entries is the author's
    // spacing, not formatting to normalize away.
    expect(held).toContain("- existing fix one (#1)\n\n- existing fix two (#2)");
    // The roll's entry lands under the label block, before the subheading.
    expect(held).toContain("- existing fix two (#2)\n- merge-marker subheading entry (#912)");
    // `### Notes` stays a heading in its own right, not a line folded into
    // the FIX block above it.
    expect(held).toContain("- merge-marker subheading entry (#912)\n\n### Notes");
    expect(held).toContain("### Notes\n\n- a hand note");
  });

  it("fails the same way for a roll and a --dry-run when CHANGELOG.md is missing", () => {
    const dir = fixture("- [FIX] entry for a missing ledger (#913)\n");
    rmSync(join(dir, "CHANGELOG.md"));

    expect(run(dir, ["1.0.0"])).toBe(1);
    expect(run(dir, ["1.0.0", "--dry-run"])).toBe(1);

    // Neither run creates a ledger, and neither consumes the fragment.
    expect(existsSync(join(dir, "CHANGELOG.md"))).toBe(false);
    expect(existsSync(join(dir, "changelog.d", "f.md"))).toBe(true);
  });
});
