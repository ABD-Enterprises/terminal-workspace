#!/usr/bin/env node
// Roll changelog.d/*.md fragments into CHANGELOG.md for a release.
//
// Each fragment holds one or more `- [LABEL] text (#id)` lines (the shape the
// changelog-discipline gate requires per PR). This inserts a
// `## <version> — <date>` section directly under `## Unreleased`, grouped by
// label in the ledger's fixed order, resets the Unreleased subsections to
// `- None.`, and deletes the consumed fragments.
//
// Usage: node scripts/roll-changelog.mjs <version> [--date YYYY-MM-DD] [--dry-run]
import { readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const LABELS = ["BREAKING", "FEATURE", "FIX", "INTERNAL", "SECURITY"];

export function collectFragments(dir) {
  const entries = {};
  for (const label of LABELS) entries[label] = [];
  const files = readdirSync(dir).filter((f) => f.endsWith(".md")).sort();
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

export function insertRelease(changelog, section) {
  const marker = "## Unreleased";
  const at = changelog.indexOf(marker);
  if (at < 0) throw new Error("CHANGELOG.md has no '## Unreleased' heading");
  // Everything between Unreleased and the next release heading is reset.
  const rest = changelog.slice(at + marker.length);
  const nextRelease = rest.search(/\n## \d/);
  const tail = nextRelease >= 0 ? rest.slice(nextRelease + 1) : "";
  const unreleased = [marker, ""];
  for (const label of LABELS) unreleased.push(`### [${label}]`, "", "- None.", "");
  return `${changelog.slice(0, at)}${unreleased.join("\n")}\n${section}\n${tail}`;
}

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
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
  const section = renderSection(version, date, entries);
  if (dryRun) {
    console.log(section);
    process.exit(0);
  }
  const changelogPath = join(root, "CHANGELOG.md");
  writeFileSync(changelogPath, insertRelease(readFileSync(changelogPath, "utf8"), section));
  for (const file of files) unlinkSync(join(root, "changelog.d", file));
  console.log(`[roll-changelog] ${version}: ${files.length} fragment(s) rolled into CHANGELOG.md`);
}
