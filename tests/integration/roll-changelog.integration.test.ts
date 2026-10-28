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

// Status plus captured stderr, to pin failure *messages* and not just codes.
function runCapture(dir: string, args: string[]) {
  try {
    execFileSync("node", [join(dir, "scripts/roll-changelog.mjs"), ...args], {
      cwd: dir,
      stdio: ["ignore", "ignore", "pipe"],
    });
    return { status: 0, stderr: "" };
  } catch (error) {
    const failure = error as { status?: number; stderr?: Buffer | string };
    return { status: failure.status ?? 1, stderr: String(failure.stderr ?? "") };
  }
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

// Insert content directly under the `## Unreleased` heading line — inside the
// block a roll resets — for the #453 refusal tests.
function injectUnderUnreleased(dir: string, text: string) {
  const path = join(dir, "CHANGELOG.md");
  const changelog = readFileSync(path, "utf8");
  const at = changelog.search(HEADING);
  if (at < 0) throw new Error("CHANGELOG.md has no '## Unreleased' heading");
  const lineEnd = changelog.indexOf("\n", at) + 1;
  writeFileSync(path, changelog.slice(0, lineEnd) + text + changelog.slice(lineEnd));
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

  it("keeps a whole release section sitting between two duplicate headings", () => {
    const dir = fixture("- [FIX] merge-marker gap entry (#914)\n");
    // Same construction as above, but a different release lands between the
    // two copies of 9.9.9. That release is not part of the duplicate: the
    // heal must fold the second copy into the first and carry the whole
    // intervening section through — dropping it is silent ledger data loss.
    addSection(dir, "## 9.9.9 — 2021-02-02\n\n### [FIX]\n\n- a later duplicate entry (#3)\n");
    addSection(dir, "## 5.5.5 — 2020-06-06\n\n### [FIX]\n\n- an intervening release entry (#5)\n");
    addSection(dir, "## 9.9.9 — 2020-01-01\n\n### [FIX]\n\n- an earlier duplicate entry (#4)\n");

    expect(run(dir, ["9.9.9", "--date", "2026-10-26"])).toBe(0);

    const after = readFileSync(join(dir, "CHANGELOG.md"), "utf8");
    expect(after.match(/^## 9\.9\.9 — /gm)).toHaveLength(1);
    expect(after).toContain("## 9.9.9 — 2020-01-01");
    expect(after).not.toContain("2021-02-02");
    // The intervening release survives whole: heading, date and entry.
    expect(after).toContain("## 5.5.5 — 2020-06-06");
    expect(after).toContain("- an intervening release entry (#5)");
    // Both duplicates' entries and the new one are in the healed section.
    const held = sectionOf(after, "## 9.9.9 — 2020-01-01");
    expect(held).toContain("- an earlier duplicate entry (#4)");
    expect(held).toContain("- a later duplicate entry (#3)");
    expect(held).toContain("- merge-marker gap entry (#914)");
    // The section boundaries keep exactly one blank line on each side of
    // the surviving gap content — the deleted duplicate's heading does not
    // leave a hole, and the re-splice does not double the separator. The
    // healed section's last line is the duplicate's folded-in entry.
    expect(after).toMatch(/\(#3\)\n\n## 5\.5\.5 — /);
    expect(after).toMatch(/\(#5\)\n\n## 0\.2\.1 — /);
    expect(after).not.toMatch(/\n\n\n## /);
  });

  it("does not treat a prerelease heading for another release as the section", () => {
    const dir = fixture("- [FIX] merge-marker stable entry (#915)\n");
    // The prerelease copy sits first, so a suffix-tolerant match would pick
    // it as the section for 9.9.9 and the heal would fold — and delete — a
    // heading that belongs to a different release.
    addSection(dir, "## 9.9.9 — 2020-01-01\n\n### [FIX]\n\n- a stable entry (#7)\n");
    addSection(dir, "## 9.9.9-verify.1 — 2021-03-03\n\n### [FIX]\n\n- a prerelease entry (#6)\n");

    expect(run(dir, ["9.9.9", "--date", "2026-10-26"])).toBe(0);

    const after = readFileSync(join(dir, "CHANGELOG.md"), "utf8");
    // The prerelease section is untouched: heading, date and entry.
    expect(after).toContain("## 9.9.9-verify.1 — 2021-03-03");
    expect(after).toContain("- a prerelease entry (#6)");
    const prerelease = sectionOf(after, "## 9.9.9-verify.1 — 2021-03-03");
    expect(prerelease).not.toContain("merge-marker stable entry");
    // The real section keeps its own heading and date and takes the entry.
    const stable = sectionOf(after, "## 9.9.9 — 2020-01-01");
    expect(stable).toContain("- a stable entry (#7)");
    expect(stable).toContain("- merge-marker stable entry (#915)");
  });

  it("writes an output that ends with a newline when the duplicate runs to the end of the ledger", () => {
    const dir = fixture("- [FIX] merge-marker tail entry (#918)\n");
    // Duplicate directly abutting the section above it (no blank separator)
    // and sitting last in a file that has no final newline: the newline
    // before its heading is the previous line's terminator, not a separator
    // to reclaim, and there is no following section to supply one.
    writeFileSync(
      join(dir, "CHANGELOG.md"),
      `${readFileSync(join(dir, "CHANGELOG.md"), "utf8").replace(/\n+$/, "\n")}## 9.9.9 — 2020-01-01\n\n### [FIX]\n\n- a first entry (#1)\n## 5.5.5 — 2020-06-06\n- an intervening entry (#2)\n## 9.9.9 — 2021-02-02\n- a duplicate tail entry (#3)`,
    );

    expect(run(dir, ["9.9.9", "--date", "2026-10-26"])).toBe(0);

    const after = readFileSync(join(dir, "CHANGELOG.md"), "utf8");
    expect(after.endsWith("\n")).toBe(true);
    expect(after.match(/^## 9\.9\.9 — /gm)).toHaveLength(1);
    // Everything is still there, in order — the duplicate's entry folded
    // into the healed section, its heading the only thing gone.
    expect(after).toContain("- a first entry (#1)");
    expect(after).toContain("- a duplicate tail entry (#3)");
    expect(after).toContain("## 5.5.5 — 2020-06-06");
    expect(after).toContain("- an intervening entry (#2)");
    expect(after).toContain("- merge-marker tail entry (#918)");
  });

  it("does not fold a duplicate's - None. placeholder under real entries", () => {
    const dir = fixture("- [FIX] merge-marker placeholder entry (#916)\n");
    // The duplicate carries placeholders on every path into the merge: a
    // preamble line before the first block, a label block holding only one,
    // and a whole label block the ledger does not have that holds only one.
    addSection(
      dir,
      "## 9.9.9 — 2021-02-02\n\n- None.\n\n### [FIX]\n\n- None.\n\n### [SECURITY]\n\n- None.\n",
    );
    addSection(dir, "## 9.9.9 — 2020-01-01\n\n### [FIX]\n\n- a real ledger entry (#8)\n");

    expect(run(dir, ["9.9.9", "--date", "2026-10-26"])).toBe(0);

    const after = readFileSync(join(dir, "CHANGELOG.md"), "utf8");
    const held = sectionOf(after, "## 9.9.9 — 2020-01-01");
    expect(held).toContain("- a real ledger entry (#8)");
    expect(held).toContain("- merge-marker placeholder entry (#916)");
    // The placeholders meant "nothing here" in the duplicate, not content:
    // not under the real entries, not in the preamble — and a label block
    // whose whole body is a placeholder is not manufactured at all.
    expect(held).not.toContain("- None.");
    expect(held).not.toContain("### [SECURITY]");
  });

  it("merges into a label heading even when the ledger wrote it with a trailing space", () => {
    const dir = fixture("- [FIX] merge-marker spaced heading entry (#919)\n");
    // Writer slop: `### [FIX] ` with a trailing space must still read as the
    // FIX block, not become a second, non-label block beside it.
    addSection(dir, "## 9.9.9 — 2020-01-01\n\n### [FIX] \n\n- a ledger entry (#11)\n");

    expect(run(dir, ["9.9.9", "--date", "2026-10-26"])).toBe(0);

    const after = readFileSync(join(dir, "CHANGELOG.md"), "utf8");
    const held = sectionOf(after, "## 9.9.9 — 2020-01-01");
    expect(held.match(/^### \[FIX\]/gm)).toHaveLength(1);
    expect(held).toContain("- a ledger entry (#11)");
    expect(held).toContain("- merge-marker spaced heading entry (#919)");
    // The heading is normalized to the exact shape on the way through.
    expect(held).not.toMatch(/^### \[FIX\] /m);
  });

  it("renders a subheading with no body once, without a double blank line", () => {
    const dir = fixture("- [FIX] merge-marker empty-block entry (#917)\n");
    addSection(dir, "## 9.9.9 — 2021-02-02\n\n### [FIX]\n\n- a duplicate entry (#9)\n\n### Notes\n");
    addSection(dir, "## 9.9.9 — 2020-01-01\n\n### [FIX]\n\n- a ledger entry (#10)\n");

    expect(run(dir, ["9.9.9", "--date", "2026-10-26"])).toBe(0);

    const after = readFileSync(join(dir, "CHANGELOG.md"), "utf8");
    // The empty `### Notes` block folds in as a heading with one separator
    // before whatever follows it.
    expect(after).toContain("### Notes");
    expect(after).not.toMatch(/\n\n\n/);
    expect(after).toContain("- a ledger entry (#10)");
    expect(after).toContain("- merge-marker empty-block entry (#917)");
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

    const write = runCapture(dir, ["1.0.0"]);
    const preview = runCapture(dir, ["1.0.0", "--dry-run"]);

    expect(write.status).toBe(1);
    expect(preview.status).toBe(1);
    // Not just the same exit code: both report the same missing-ledger
    // message (the stacks differ by call site, the error line does not).
    const message = (stderr: string) => stderr.split("\n").find((line) => line.startsWith("Error: "));
    expect(message(write.stderr)).toContain("CHANGELOG.md is missing");
    expect(message(preview.stderr)).toBe(message(write.stderr));

    // Neither run creates a ledger, and neither consumes the fragment.
    expect(existsSync(join(dir, "CHANGELOG.md"))).toBe(false);
    expect(existsSync(join(dir, "changelog.d", "f.md"))).toBe(true);
  });

  // #453: the reset rebuilds the Unreleased block from the fixed five-label
  // skeleton, so a roll must refuse — exit 1, identically on the write and
  // the --dry-run path — when the block holds anything else, instead of
  // silently deleting it.

  it("refuses a roll that would discard non-label content under Unreleased", () => {
    const dir = fixture("- [FIX] merge-marker unreleased-guard entry (#920)\n");
    injectUnderUnreleased(dir, "### Notes\n\n- prose under Unreleased\n");
    const path = join(dir, "CHANGELOG.md");
    const before = readFileSync(path, "utf8");

    const write = runCapture(dir, ["9.9.9", "--date", "2026-10-26"]);
    const preview = runCapture(dir, ["9.9.9", "--date", "2026-10-26", "--dry-run"]);

    expect(write.status).toBe(1);
    expect(preview.status).toBe(1);
    // Not just the same exit code: both report the same refusal, naming the
    // offending line and what to do with it (the stacks differ by call site).
    const message = (stderr: string) => stderr.split("\n").find((line) => line.startsWith("Error: "));
    expect(message(write.stderr)).toContain("non-label content under '## Unreleased'");
    expect(message(write.stderr)).toContain("### Notes");
    expect(message(write.stderr)).toContain("below a release heading");
    expect(message(preview.stderr)).toBe(message(write.stderr));
    // The refusal changes nothing: the ledger stays byte-identical, the
    // fragment is not consumed.
    expect(readFileSync(path, "utf8")).toBe(before);
    expect(existsSync(join(dir, "changelog.d", "f.md"))).toBe(true);
  });

  it("refuses when Unreleased is the last heading and prose follows the skeleton", () => {
    const dir = fixture("- [FIX] merge-marker unreleased-tail entry (#921)\n");
    // Cut every release section off the ledger: the block the reset would
    // rebuild now runs to the end of the file, so the prose after the
    // skeleton is everything a roll would lose, with no tail to fall back on.
    const path = join(dir, "CHANGELOG.md");
    const changelog = readFileSync(path, "utf8");
    const at = changelog.search(/^## \d/m);
    if (at < 0) throw new Error("fixture ledger has no release heading");
    writeFileSync(path, `${changelog.slice(0, at)}- prose where a release heading would go\n`);
    const before = readFileSync(path, "utf8");

    const write = runCapture(dir, ["9.9.9", "--date", "2026-10-26"]);
    const preview = runCapture(dir, ["9.9.9", "--date", "2026-10-26", "--dry-run"]);

    expect(write.status).toBe(1);
    expect(preview.status).toBe(1);
    const message = (stderr: string) => stderr.split("\n").find((line) => line.startsWith("Error: "));
    expect(message(write.stderr)).toContain("non-label content under '## Unreleased'");
    expect(message(preview.stderr)).toBe(message(write.stderr));
    expect(readFileSync(path, "utf8")).toBe(before);
    expect(existsSync(join(dir, "changelog.d", "f.md"))).toBe(true);
  });

  // #453: on the heal's block-creation path a non-label subheading carried
  // over from the duplicate keeps its `- None.` body unless the filter in
  // mergeSection drops it; deleting that filter must fail the test below.

  it("drops a duplicate's placeholder body when creating its non-label block", () => {
    const dir = fixture("- [FIX] merge-marker notes-pin entry (#922)\n");
    // The duplicate ends with a non-label `### Notes` block whose whole body
    // is a placeholder; the earlier-dated copy lands first and survives as
    // the section.
    addSection(
      dir,
      "## 9.9.9 — 2021-02-02\n\n### [FIX]\n\n- a later copy entry (#12)\n\n### Notes\n\n- None.\n",
    );
    addSection(dir, "## 9.9.9 — 2020-01-01\n\n### [FIX]\n\n- an earlier copy entry (#13)\n");

    expect(run(dir, ["9.9.9", "--date", "2026-10-26"])).toBe(0);

    const after = readFileSync(join(dir, "CHANGELOG.md"), "utf8");
    expect(after.match(/^## 9\.9\.9 — /gm)).toHaveLength(1);
    const held = sectionOf(after, "## 9.9.9 — 2020-01-01");
    expect(held).toContain("- a later copy entry (#12)");
    expect(held).toContain("- an earlier copy entry (#13)");
    expect(held).toContain("- merge-marker notes-pin entry (#922)");
    // The heading survives exactly once; its placeholder body does not.
    expect(held.match(/^### Notes$/gm)).toHaveLength(1);
    expect(held).not.toContain("- None.");
  });

  // #453: `--date` lands in a `## <version> — <date>` heading line, so a
  // malformed, newline-injected or missing value is rejected with exit 2
  // before either the write or the --dry-run path runs.

  it("--date rejects a malformed, newline-injected or missing value before either path", () => {
    const dir = fixture("- [FIX] merge-marker date entry (#923)\n");
    const path = join(dir, "CHANGELOG.md");
    const before = readFileSync(path, "utf8");

    for (const args of [
      ["9.9.9", "--date", "2026-1-1"],
      ["9.9.9", "--date", "2026-01-01\n## 9.9.9 — injected"],
      ["9.9.9", "--date"],
    ]) {
      // The write and --dry-run alike: the check sits before both.
      expect(runCapture(dir, args).status).toBe(2);
      expect(runCapture(dir, [...args, "--dry-run"]).status).toBe(2);
      // The rejection changes nothing: the ledger stays byte-identical, the
      // fragment is not consumed.
      expect(readFileSync(path, "utf8")).toBe(before);
      expect(existsSync(join(dir, "changelog.d", "f.md"))).toBe(true);
    }
    // The usage line, not a stack trace.
    expect(runCapture(dir, ["9.9.9", "--date", "2026-1-1"]).stderr).toContain(
      "usage: roll-changelog.mjs",
    );

    // A well-formed date still previews: exit 0, nothing written.
    const preview = runOut(dir, ["9.9.9", "--date", "2026-10-26", "--dry-run"]);
    expect(preview).toContain("## 9.9.9 — 2026-10-26");
    expect(readFileSync(path, "utf8")).toBe(before);
    expect(existsSync(join(dir, "changelog.d", "f.md"))).toBe(true);
  });
});
