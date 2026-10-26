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
// every content line the ledger already holds kept) instead of inserting a
// second heading for the same release; only blank-line formatting is
// normalized. A version with
// no section yet is inserted directly under `## Unreleased`. Either way the
// Unreleased subsections reset to `- None.` and the consumed fragments go.
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

// Split a rendered release section into its heading line, any content above
// the first label block, and its `### [LABEL]` blocks in the order the ledger
// holds them. Every non-blank line is kept exactly as written — prose,
// indented continuations and `- ` entries alike — so merging never drops what
// a human wrote into the ledger. Blank lines are formatting: the merge
// re-renders them.
function splitSection(section) {
  const lines = section.split("\n");
  const heading = lines.shift();
  if (lines[0] === "") lines.shift();
  const preamble = [];
  const blocks = [];
  for (const line of lines) {
    if (line === "") continue;
    const m = line.match(/^### \[(BREAKING|FEATURE|FIX|INTERNAL|SECURITY)\]$/);
    if (m) {
      blocks.push({ label: m[1], lines: [] });
      continue;
    }
    const top = blocks[blocks.length - 1];
    if (top) top.lines.push(line);
    else preamble.push(line);
  }
  return { heading, preamble, blocks };
}

// Add a label block the section does not have yet at its position in the
// fixed order, so a new BREAKING block lands above an existing FIX block
// rather than at the end of the section.
function insertBlock(blocks, label) {
  const rank = LABELS.indexOf(label);
  const block = { label, lines: [] };
  const at = blocks.findIndex((b) => LABELS.indexOf(b.label) > rank);
  if (at < 0) blocks.push(block);
  else blocks.splice(at, 0, block);
  return block;
}

function renderBlocks({ heading, preamble, blocks }) {
  const out = [heading, ""];
  if (preamble.length > 0) out.push(...preamble, "");
  for (const block of blocks) {
    out.push(`### [${block.label}]`, "");
    out.push(...block.lines, "");
  }
  return out.join("\n");
}

// Merge an incoming roll into the section the ledger already holds for that
// version: the original heading and date stay, each new entry is appended
// under its label, a label block the section is missing is created in the
// fixed order, a lone `- None.` placeholder is replaced rather than left above
// the new entry, and an entry already present byte-for-byte is not repeated.
// Lines the ledger already holds — prose and indented continuations included —
// pass through untouched.
function mergeSection(existing, incoming) {
  const ledger = splitSection(existing);
  const roll = splitSection(incoming);
  for (const block of roll.blocks) {
    const target = ledger.blocks.find((b) => b.label === block.label) ?? insertBlock(ledger.blocks, block.label);
    const added = [...new Set(block.lines)].filter((line) => !target.lines.includes(line));
    if (added.length === 0) continue;
    if (target.lines.length === 1 && target.lines[0] === "- None.") target.lines.length = 0;
    target.lines.push(...added);
  }
  return renderBlocks(ledger);
}

// The section the ledger already holds for `version`, if any. Line-scanned
// rather than built as a RegExp: `version` comes from argv, and a
// non-literal pattern is exactly what the Semgrep gate blocks. The match must
// sit at a line start with no word character or dot immediately after it, so
// 0.2.1 cannot match a 0.2.10 heading or a mention mid-line; it ends just
// before the next `## ` heading.
function findRelease(changelog, version) {
  const needle = `## ${version}`;
  let start = -1;
  for (let from = 0; ; ) {
    const at = changelog.indexOf(needle, from);
    if (at < 0) break;
    const lineStart = changelog.lastIndexOf("\n", at - 1) + 1;
    const after = changelog[at + needle.length];
    if (lineStart === at && (after === undefined || !/[\w.]/.test(after))) {
      start = at;
      break;
    }
    from = at + needle.length;
  }
  if (start < 0) return null;
  const rest = changelog.slice(start);
  const next = rest.search(/\n## /);
  const end = next >= 0 ? start + next : changelog.length;
  return { start, end, text: changelog.slice(start, end) };
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
  const held = findRelease(split.tail, version);
  if (held) {
    // One heading, one date: merge under the section that already exists.
    return `${head}${split.tail.slice(0, held.start)}${mergeSection(held.text, section)}${split.tail.slice(held.end)}`;
  }
  return `${head}${section}\n${split.tail}`;
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
    // Preview what a real run would write, searching the same part of the
    // ledger the write searches (below `## Unreleased`), so the preview can
    // never disagree with the write. A missing CHANGELOG.md is a preview
    // against an empty ledger, not a crash; a ledger without an Unreleased
    // heading fails here exactly as the real run would.
    let ledger = "";
    try {
      ledger = readFileSync(changelogPath, "utf8");
    } catch (err) {
      if (!err || err.code !== "ENOENT") throw err;
    }
    const split = unreleasedSplit(ledger);
    if (split) {
      const held = findRelease(split.tail, version);
      console.log(held ? mergeSection(held.text, section) : section);
    } else if (ledger === "") {
      console.log(section);
    } else {
      throw new Error("CHANGELOG.md has no '## Unreleased' heading");
    }
    process.exit(0);
  }
  writeFileSync(changelogPath, insertRelease(readFileSync(changelogPath, "utf8"), section, version));
  for (const file of files) unlinkSync(join(root, "changelog.d", file));
  console.log(`[roll-changelog] ${version}: ${files.length} fragment(s) rolled into CHANGELOG.md`);
}
