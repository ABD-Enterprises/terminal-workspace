#!/usr/bin/env node
// Roll changelog.d/*.md fragments into CHANGELOG.md for a release.
//
// Each fragment holds one or more `- [LABEL] text (#id)` lines (the shape the
// PR template requires per PR). This renders them as a
// `## <version> — <date>` section grouped by label in the ledger's fixed
// order. When the ledger already holds a section for that version — the state
// a second roll of a partially rolled release lands in — the entries are
// merged into it (original heading and date kept, a missing label block
// created, a `- None.` placeholder replaced, an entry already present skipped)
// instead of inserting a second heading for the same release. A version with
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

// Split a rendered release section into its heading line and its
// `### [LABEL]` blocks, in the order the ledger holds them. Blank lines are
// formatting — the merge re-renders them — so only the heading, the label
// lines and the `- ` entries are kept.
function splitSection(section) {
  const lines = section.split("\n");
  const heading = lines.shift();
  if (lines[0] === "") lines.shift();
  const blocks = [];
  for (const line of lines) {
    const m = line.match(/^### \[(BREAKING|FEATURE|FIX|INTERNAL|SECURITY)\]$/);
    if (m) {
      blocks.push({ label: m[1], entries: [] });
      continue;
    }
    const top = blocks[blocks.length - 1];
    if (top && line.startsWith("- ")) top.entries.push(line.slice(2));
  }
  return { heading, blocks };
}

// Add a label block the section does not have yet at its position in the
// fixed order, so a new BREAKING block lands above an existing FIX block
// rather than at the end of the section.
function insertBlock(blocks, label) {
  const rank = LABELS.indexOf(label);
  const block = { label, entries: [] };
  const at = blocks.findIndex((b) => LABELS.indexOf(b.label) > rank);
  if (at < 0) blocks.push(block);
  else blocks.splice(at, 0, block);
  return block;
}

function renderBlocks(heading, blocks) {
  const out = [heading, ""];
  for (const block of blocks) {
    out.push(`### [${block.label}]`, "");
    for (const entry of block.entries) out.push(`- ${entry}`);
    out.push("");
  }
  return out.join("\n");
}

// Merge an incoming roll into the section the ledger already holds for that
// version: the original heading and date stay, each new entry is appended
// under its label, a label block the section is missing is created in the
// fixed order, a `- None.` placeholder is replaced rather than left above the
// new entry, and an entry already present byte-for-byte is not repeated.
function mergeSection(existing, incoming) {
  const ledger = splitSection(existing);
  const roll = splitSection(incoming);
  for (const block of roll.blocks) {
    const target = ledger.blocks.find((b) => b.label === block.label) ?? insertBlock(ledger.blocks, block.label);
    const added = [...new Set(block.entries)].filter((entry) => !target.entries.includes(entry));
    if (added.length === 0) continue;
    if (target.entries.length === 1 && target.entries[0] === "None.") target.entries.length = 0;
    target.entries.push(...added);
  }
  return renderBlocks(ledger.heading, ledger.blocks);
}

// The section the ledger already holds for `version`, if any. Anchored on
// `## <version>` at a line start with a word boundary, so 0.2.1 cannot match
// a 0.2.10 heading, and ending just before the next `## ` heading.
function findRelease(changelog, version) {
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const start = changelog.search(new RegExp(`^## ${escaped}\\b`, "m"));
  if (start < 0) return null;
  const rest = changelog.slice(start);
  const next = rest.search(/\n## /);
  const end = next >= 0 ? start + next : changelog.length;
  return { start, end, text: changelog.slice(start, end) };
}

export function insertRelease(changelog, section, version) {
  const marker = "## Unreleased";
  // Anchor on a real heading line, not the first substring: the intro and any
  // prose must survive the splice.
  const at = changelog.search(/^## Unreleased[ \t]*$/m);
  if (at < 0) throw new Error("CHANGELOG.md has no '## Unreleased' heading");
  // Everything between Unreleased and the next release heading is reset.
  const rest = changelog.slice(at + marker.length);
  const nextRelease = rest.search(/\n## \d/);
  const tailAt = nextRelease >= 0 ? at + marker.length + nextRelease + 1 : changelog.length;
  const unreleased = [marker, ""];
  for (const label of LABELS) unreleased.push(`### [${label}]`, "", "- None.", "");
  const head = `${changelog.slice(0, at)}${unreleased.join("\n")}\n`;
  const tail = changelog.slice(tailAt);
  const held = findRelease(tail, version);
  if (held) {
    // One heading, one date: merge under the section that already exists.
    return `${head}${tail.slice(0, held.start)}${mergeSection(held.text, section)}${tail.slice(held.end)}`;
  }
  return `${head}${section}\n${tail}`;
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
    // Preview what a real run would write: an existing section for this
    // version is shown merged, not as a second heading. A missing CHANGELOG.md
    // is a preview against an empty ledger, not a crash.
    let ledger = "";
    try {
      ledger = readFileSync(changelogPath, "utf8");
    } catch (err) {
      if (!err || err.code !== "ENOENT") throw err;
    }
    const held = findRelease(ledger, version);
    console.log(held ? mergeSection(held.text, section) : section);
    process.exit(0);
  }
  writeFileSync(changelogPath, insertRelease(readFileSync(changelogPath, "utf8"), section, version));
  for (const file of files) unlinkSync(join(root, "changelog.d", file));
  console.log(`[roll-changelog] ${version}: ${files.length} fragment(s) rolled into CHANGELOG.md`);
}
