#!/usr/bin/env node
// Roll changelog.d/*.md fragments into CHANGELOG.md for a release.
//
// Each fragment holds one or more `- [LABEL] text (#id)` lines (the shape the
// PR template requires per PR). This renders them as a
// `## <version> — <date>` section grouped by label in the ledger's fixed
// order. When the ledger already holds a section for that version — the state
// a second roll of a partially rolled release lands in — the entries are
// merged into it (original heading and date kept, a missing label block
// created, a `- None.` placeholder replaced, an entry already present skipped,
// every content line the ledger already holds kept, a non-label `### `
// subheading kept as its own block) instead of inserting a second heading for
// the same release; only blank-line formatting is normalized. A ledger that
// already holds two headings for one version is healed: every duplicate is
// folded into the first section and the extra headings go. A version with
// no section yet is inserted directly under `## Unreleased`. Either way the
// Unreleased subsections reset to `- None.` and the consumed fragments go.
// `--dry-run` reads the ledger the same way the write does and prints the
// same section the write splices, so a preview cannot succeed — or disagree —
// where the real run would not.
//
// Usage: node scripts/roll-changelog.mjs <version> [--date YYYY-MM-DD] [--dry-run]
import { readdirSync, readFileSync, realpathSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const LABELS = ["BREAKING", "FEATURE", "FIX", "INTERNAL", "SECURITY"];

// A missing changelog.d/ (or one whose fragments were all consumed by an
// earlier roll) is a normal state, not a crash: report it as "no fragments"
// instead of failing with a raw ENOENT.
function readFragmentFiles(dir) {
  let names;
  try {
    names = readdirSync(dir);
  } catch (err) {
    if (err && (err.code === "ENOENT" || err.code === "ENOTDIR")) return [];
    throw err;
  }
  return names.filter((f) => f.endsWith(".md")).sort();
}

export function collectFragments(dir) {
  const entries = {};
  for (const label of LABELS) entries[label] = [];
  const files = readFragmentFiles(dir);
  for (const file of files) {
    for (const raw of readFileSync(join(dir, file), "utf8").split("\n")) {
      const line = raw.trim();
      if (!line) continue;
      const m = line.match(/^- \[(BREAKING|FEATURE|FIX|INTERNAL|SECURITY)\]\s+(.*)$/);
      if (!m) throw new Error(`${file}: line is not '- [LABEL] text': ${line}`);
      entries[m[1]].push(m[2]);
    }
  }
  return { files, entries };
}

export function renderSection(version, date, entries) {
  const out = [`## ${version} — ${date}`, ""];
  for (const label of LABELS) {
    if (entries[label].length === 0) continue;
    out.push(`### [${label}]`, "");
    for (const text of entries[label]) out.push(`- ${text}`);
    out.push("");
  }
  return out.join("\n");
}

// Strip the blank lines hugging a block's edges — a heading's own separator
// and the gap before the next block are formatting the render re-adds. Blank
// lines *between* content lines are the author's spacing and stay.
function trimEdges(lines) {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start] === "") start += 1;
  while (end > start && lines[end - 1] === "") end -= 1;
  return lines.slice(start, end);
}

// Split a rendered release section into its heading line, any content above
// the first block, and its blocks in the order the ledger holds them: the
// `### [LABEL]` blocks a roll renders, plus any other `### ` subheading a
// human wrote, which becomes a block of its own so a merge never re-parents
// it under a label. Every non-blank line is kept exactly as written — prose,
// indented continuations and `- ` entries alike — and blank lines between
// content lines survive too, so merging never drops what a human wrote into
// the ledger.
function splitSection(section) {
  const lines = section.split("\n");
  const heading = lines.shift();
  if (lines[0] === "") lines.shift();
  const preamble = [];
  const blocks = [];
  let current = null;
  for (const line of lines) {
    if (line.startsWith("### ")) {
      const m = line.match(/^### \[(BREAKING|FEATURE|FIX|INTERNAL|SECURITY)\]$/);
      current = { label: m ? m[1] : null, raw: line, lines: [] };
      blocks.push(current);
      continue;
    }
    if (current) current.lines.push(line);
    else preamble.push(line);
  }
  return {
    heading,
    preamble: trimEdges(preamble),
    blocks: blocks.map((block) => ({ ...block, lines: trimEdges(block.lines) })),
  };
}

// Add a block the section does not have yet: a label block at its position in
// the fixed order, so a new BREAKING block lands above an existing FIX block
// rather than at the end of the section; a non-label subheading at the end,
// where the ledger stopped writing.
function insertBlock(blocks, block) {
  if (block.label === null) {
    blocks.push(block);
    return block;
  }
  const rank = LABELS.indexOf(block.label);
  const at = blocks.findIndex((b) => b.label !== null && LABELS.indexOf(b.label) > rank);
  if (at < 0) blocks.push(block);
  else blocks.splice(at, 0, block);
  return block;
}

function renderBlocks({ heading, preamble, blocks }) {
  const out = [heading, ""];
  if (preamble.length > 0) out.push(...preamble, "");
  for (const block of blocks) {
    out.push(block.raw, "");
    out.push(...block.lines, "");
  }
  return out.join("\n");
}

// Merge an incoming roll into the section the ledger already holds for that
// version: the original heading and date stay, each new entry is appended
// under its label, a label block the section is missing is created in the
// fixed order, a lone `- None.` placeholder is replaced rather than left above
// the new entry, and an entry already present byte-for-byte is not repeated.
// Lines the ledger already holds — prose, subheadings and indented
// continuations included — pass through in their own place. The incoming side
// carries prose above its first block only when a duplicate section is being
// healed; that prose is kept too, after the ledger's.
function mergeSection(existing, incoming) {
  const ledger = splitSection(existing);
  const roll = splitSection(incoming);
  for (const line of roll.preamble) {
    if (!ledger.preamble.includes(line)) ledger.preamble.push(line);
  }
  for (const block of roll.blocks) {
    const match = ledger.blocks.find(
      (b) => b.label === block.label && (block.label !== null || b.raw === block.raw),
    );
    const target = match ?? insertBlock(ledger.blocks, block);
    // Blank lines are formatting on the way in; the ledger's own interior
    // blanks stay put above.
    const added = [...new Set(block.lines.filter((line) => line !== ""))].filter(
      (line) => !target.lines.includes(line),
    );
    if (added.length === 0) continue;
    if (target.lines.length === 1 && target.lines[0] === "- None.") target.lines.length = 0;
    target.lines.push(...added);
  }
  return renderBlocks(ledger);
}

// Every section the ledger holds for `version`, in file order. Line-scanned
// rather than built as a RegExp: `version` comes from argv, and a
// non-literal pattern is exactly what the Semgrep gate blocks. The match must
// sit at a line start with no word character or dot immediately after it, so
// 0.2.1 cannot match a 0.2.10 heading or a mention mid-line; each section
// ends just before the next `## ` heading. More than one match means the
// ledger already holds two headings for one release — the roll heals those by
// folding every duplicate into the first section.
function findReleases(changelog, version) {
  const needle = `## ${version}`;
  const found = [];
  for (let from = 0; ; ) {
    const at = changelog.indexOf(needle, from);
    if (at < 0) break;
    const lineStart = changelog.lastIndexOf("\n", at - 1) + 1;
    const after = changelog[at + needle.length];
    if (lineStart === at && (after === undefined || !/[\w.]/.test(after))) {
      const rest = changelog.slice(at);
      const next = rest.search(/\n## /);
      const end = next >= 0 ? at + next : changelog.length;
      found.push({ start: at, end, text: changelog.slice(at, end) });
      from = end;
      continue;
    }
    from = at + needle.length;
  }
  return found;
}

// The section a roll writes for `version`: merged with the section the ledger
// already holds below `## Unreleased` — every duplicate folded into the first
// — or the raw render when it holds none. The write splices this text and
// `--dry-run` prints this text, so a preview can never disagree with the run.
function rolledSection(tail, section, version) {
  const held = findReleases(tail, version);
  if (held.length === 0) return { held, text: section };
  let text = mergeSection(held[0].text, section);
  for (const dup of held.slice(1)) text = mergeSection(text, dup.text);
  return { held, text };
}

// Everything below the Unreleased block — the release sections a roll may
// merge into. Both the real run and --dry-run go through this, so a preview
// can never search a different part of the ledger than the write does.
function unreleasedSplit(changelog) {
  const marker = "## Unreleased";
  // Anchor on a real heading line, not the first substring: the intro and any
  // prose must survive the splice.
  const at = changelog.search(/^## Unreleased[ \t]*$/m);
  if (at < 0) return null;
  // Everything between Unreleased and the next release heading is reset.
  const rest = changelog.slice(at + marker.length);
  const nextRelease = rest.search(/\n## \d/);
  const tailAt = nextRelease >= 0 ? at + marker.length + nextRelease + 1 : changelog.length;
  return { at, tail: changelog.slice(tailAt) };
}

export function insertRelease(changelog, section, version) {
  const split = unreleasedSplit(changelog);
  if (!split) throw new Error("CHANGELOG.md has no '## Unreleased' heading");
  const unreleased = ["## Unreleased", ""];
  for (const label of LABELS) unreleased.push(`### [${label}]`, "", "- None.", "");
  const head = `${changelog.slice(0, split.at)}${unreleased.join("\n")}\n`;
  const { held, text } = rolledSection(split.tail, section, version);
  if (held.length === 0) return `${head}${section}\n${split.tail}`;
  // One heading, one date: merge under the first section the ledger holds and
  // drop every duplicate heading, its content already folded in.
  let tail = split.tail.slice(0, held[0].start) + text;
  let cursor = held[0].end;
  for (const dup of held.slice(1)) {
    // Anything sitting between the two duplicates — another release's
    // section, prose — is not part of the duplicate and stays; only the
    // duplicate's own region goes. The gap ends on the newline that served
    // as the duplicate heading's blank separator; the heading is going, so
    // that newline goes with it and the trailing slice supplies the single
    // separator the following section needs.
    const gap = split.tail.slice(cursor, dup.start);
    if (!/^\s*$/.test(gap)) tail += gap.slice(0, -1);
    cursor = dup.end;
  }
  return `${head}${tail}${split.tail.slice(cursor)}`;
}

// Both the write and --dry-run read the ledger through this, so a missing
// CHANGELOG.md fails identically for each — exit 1 with the same message —
// instead of the preview printing against an empty ledger the real run would
// refuse to write.
function readLedger(changelogPath) {
  try {
    return readFileSync(changelogPath, "utf8");
  } catch (err) {
    if (err && err.code === "ENOENT") {
      throw new Error("CHANGELOG.md is missing — a roll and its --dry-run both need an existing ledger", {
        cause: err,
      });
    }
    throw err;
  }
}

// Compare real paths: through a symlinked prefix (macOS /var -> /private/var)
// an absolute argv would otherwise mismatch import.meta.url and the script
// would silently do nothing while exiting 0.
const invokedDirectly = (() => {
  if (!process.argv[1]) return false;
  try { return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]); }
  catch { return false; }
})();
if (invokedDirectly) {
  const version = process.argv[2];
  if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
    console.error("usage: roll-changelog.mjs <version> [--date YYYY-MM-DD] [--dry-run]");
    process.exit(2);
  }
  const dateFlag = process.argv.indexOf("--date");
  const date = dateFlag > -1 ? process.argv[dateFlag + 1] : new Date().toISOString().slice(0, 10);
  const dryRun = process.argv.includes("--dry-run");
  const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
  const { files, entries } = collectFragments(join(root, "changelog.d"));
  if (files.length === 0 || LABELS.every((label) => entries[label].length === 0)) {
    console.error("[roll-changelog] no fragments in changelog.d/ (missing, empty or blank) — nothing to roll");
    process.exit(dryRun ? 0 : 1);
  }
  const section = renderSection(version, date, entries);
  const changelogPath = join(root, "CHANGELOG.md");
  if (dryRun) {
    // Print exactly the section a real run would splice: the same ledger read
    // (a missing file fails here as it does there, exit 1), the same
    // Unreleased-anchored tail, the same merge — so a preview can neither
    // succeed nor disagree where the write would fail or differ. A ledger
    // without an Unreleased heading fails here exactly as the real run does.
    const ledger = readLedger(changelogPath);
    const split = unreleasedSplit(ledger);
    if (!split) throw new Error("CHANGELOG.md has no '## Unreleased' heading");
    console.log(rolledSection(split.tail, section, version).text);
    process.exit(0);
  }
  writeFileSync(changelogPath, insertRelease(readLedger(changelogPath), section, version));
  for (const file of files) unlinkSync(join(root, "changelog.d", file));
  console.log(`[roll-changelog] ${version}: ${files.length} fragment(s) rolled into CHANGELOG.md`);
}
