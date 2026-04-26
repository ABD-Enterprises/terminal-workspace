#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const args = process.argv.slice(2);
let repoRoot = process.cwd();

for (let index = 0; index < args.length; index += 1) {
  if (args[index] === "--repo") {
    repoRoot = path.resolve(args[index + 1] || ".");
    index += 1;
  }
}

const SEMVER_CORE =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:alpha|beta|rc)\.(?:0|[1-9]\d*))?(?:\+build\.(?:0|[1-9]\d*))?$/;
const FOUR_PART =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function readIfExists(relativePath) {
  const absolutePath = path.join(repoRoot, relativePath);
  if (!fs.existsSync(absolutePath)) return null;
  return fs.readFileSync(absolutePath, "utf8");
}

function parsePackageVersion() {
  const content = readIfExists("package.json");
  if (!content) return [];
  const parsed = JSON.parse(content);
  return parsed.version ? [{ source: "package.json", version: String(parsed.version) }] : [];
}

function parsePyprojectVersion() {
  const content = readIfExists("pyproject.toml");
  if (!content) return [];
  const match = content.match(/^\s*version\s*=\s*["']([^"']+)["']\s*$/m);
  return match ? [{ source: "pyproject.toml", version: match[1] }] : [];
}

function parseVersionFile() {
  const content = readIfExists("VERSION");
  if (!content) return [];
  const version = content.trim();
  return version ? [{ source: "VERSION", version }] : [];
}

function parseChangelogVersion() {
  const content = readIfExists("CHANGELOG.md");
  if (!content) return [];
  const match = content.match(
    /^##\s+\[?v?(\d+\.\d+\.\d+(?:-(?:alpha|beta|rc)\.\d+)?(?:\+build\.\d+)?)\]?/m
  );
  return match ? [{ source: "CHANGELOG.md", version: match[1] }] : [];
}

function parseLatestGitTag() {
  try {
    const output = execFileSync("git", ["tag", "--list", "v*", "--sort=-v:refname"], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    });
    const tag = output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean);
    if (!tag) return [];
    const match = tag.match(/^v(\d+\.\d+\.\d+(?:-(?:alpha|beta|rc)\.\d+)?(?:\+build\.\d+)?)$/);
    return match ? [{ source: "latest git tag", version: match[1] }] : [];
  } catch {
    return [];
  }
}

function isValidVersion(version) {
  return SEMVER_CORE.test(version) || FOUR_PART.test(version);
}

function coreVersion(version) {
  const match = version.match(/^(\d+\.\d+\.\d+)/);
  return match ? match[1] : version;
}

const sources = [
  ...parsePackageVersion(),
  ...parsePyprojectVersion(),
  ...parseVersionFile(),
  ...parseChangelogVersion(),
  ...parseLatestGitTag()
];

const uniqueSources = [];
const seen = new Set();
for (const source of sources) {
  const key = `${source.source}:${source.version}`;
  if (!seen.has(key)) {
    uniqueSources.push(source);
    seen.add(key);
  }
}

const failures = [];

if (uniqueSources.length === 0) {
  failures.push(
    "No repo-level version found. Add package.json version, pyproject.toml version, CHANGELOG.md release, git tag, or root VERSION. If unknown, start at 1.0.0."
  );
}

for (const { source, version } of uniqueSources) {
  if (!isValidVersion(version)) {
    failures.push(
      `${source} version "${version}" must match MAJOR.MINOR.PATCH, MAJOR.MINOR.PATCH.BUILD, or MAJOR.MINOR.PATCH+build.BUILD.`
    );
  }
}

const sourceCoreVersions = uniqueSources
  .filter(({ source }) => source !== "latest git tag")
  .map(({ version }) => coreVersion(version));
const distinctSourceCores = [...new Set(sourceCoreVersions)];
if (distinctSourceCores.length > 1) {
  failures.push(
    `Version sources disagree on release core: ${uniqueSources
      .filter(({ source }) => source !== "latest git tag")
      .map(({ source, version }) => `${source}=${version}`)
      .join(", ")}.`
  );
}

if (failures.length > 0) {
  console.error("[enforce-versioning-standard] Versioning validation failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(
  `[enforce-versioning-standard] OK: ${uniqueSources
    .map(({ source, version }) => `${source}=${version}`)
    .join(", ")}`
);
