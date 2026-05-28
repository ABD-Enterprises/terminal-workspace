import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";

function git(args, { cwd, allowFail = false } = {}) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error) {
    throw new Error(`Failed to invoke git: ${result.error.message}`);
  }
  if (!allowFail && result.status !== 0) {
    throw new Error(
      `git ${args.join(" ")} exited ${result.status}: ${result.stderr.trim()}`,
    );
  }
  return { code: result.status, stdout: result.stdout.trim(), stderr: result.stderr.trim() };
}

export function repoRoot(cwd = process.cwd()) {
  return git(["rev-parse", "--show-toplevel"], { cwd }).stdout;
}

function gitCommonDir(cwd) {
  return git(["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd }).stdout;
}

function gitDir(cwd) {
  return git(["rev-parse", "--path-format=absolute", "--git-dir"], { cwd }).stdout;
}

export function currentBranch(cwd) {
  return git(["rev-parse", "--abbrev-ref", "HEAD"], { cwd }).stdout;
}

export function checkoutBranch(name, cwd) {
  const exists = git(["rev-parse", "--verify", `refs/heads/${name}`], {
    cwd,
    allowFail: true,
  });
  if (exists.code === 0) {
    git(["switch", name], { cwd });
  } else {
    const remoteExists = git(["rev-parse", "--verify", `refs/remotes/origin/${name}`], {
      cwd,
      allowFail: true,
    });
    if (remoteExists.code === 0) {
      git(["switch", "--track", `origin/${name}`], { cwd });
    } else {
      git(["switch", "-c", name], { cwd });
    }
  }
}

export function fetchOrigin(cwd) {
  const origin = git(["remote", "get-url", "origin"], { cwd, allowFail: true });
  if (origin.code !== 0) return false;

  const result = git(["fetch", "--prune", "origin"], { cwd, allowFail: true });
  return result.code === 0;
}

export function fastForwardCurrentBranch(cwd) {
  const upstream = git(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], {
    cwd,
    allowFail: true,
  });
  if (upstream.code !== 0) return false;

  git(["pull", "--ff-only"], { cwd });
  return true;
}

const ID_RE = /^(?:ai\/)?([A-Z][A-Z0-9]+-\d+|\d+)(?:[-_/].*)?$/;

export function parseTicketIdFromBranch(branch) {
  if (!branch) return null;
  const m = branch.match(ID_RE);
  return m ? m[1] : null;
}

export function slugify(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export function branchNameFor(id, title) {
  const slug = slugify(title);
  return slug ? `${id}-${slug}` : `${id}`;
}

export function ensureLocalExclude(repoRootDir, line) {
  const dir = resolve(gitDir(repoRootDir), "info");
  const path = resolve(dir, "exclude");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  let body = "";
  if (existsSync(path)) body = readFileSync(path, "utf8");
  const trimmed = line.trim();
  if (body.split("\n").map((l) => l.trim()).includes(trimmed)) return;
  if (body && !body.endsWith("\n")) body += "\n";
  body += `${line}\n`;
  writeFileSync(path, body);
}

export function isTracked(repoRootDir, relativePath) {
  const result = git(["ls-files", "--error-unmatch", relativePath], {
    cwd: repoRootDir,
    allowFail: true,
  });
  return result.code === 0;
}

export function stagePath(repoRootDir, relativePath) {
  git(["add", "-f", "--", relativePath], { cwd: repoRootDir });
}

// Return every tracked path in the repo (no pathspec filtering). Used by
// adopt to find tracked Mac-metadata files anywhere in the tree, since
// macOS scatters .DS_Store across every directory it touches.
export function listTrackedFiles(repoRootDir) {
  const result = git(["ls-files"], { cwd: repoRootDir });
  return result.stdout ? result.stdout.split("\n").filter(Boolean) : [];
}

// Stage a deletion from the index without touching the working tree.
// Used by adopt to retroactively untrack files that should have been
// gitignored from the start (e.g., .DS_Store committed before .gitignore
// caught up). Caller is responsible for committing the result.
export function untrackPath(repoRootDir, relativePath) {
  git(["rm", "--cached", "--quiet", "--", relativePath], { cwd: repoRootDir });
}

export function removeLocalExclude(repoRootDir, line) {
  const path = resolve(gitDir(repoRootDir), "info/exclude");
  if (!existsSync(path)) return;
  const trimmed = line.trim();
  const body = readFileSync(path, "utf8");
  const next = body
    .split("\n")
    .filter((l) => l.trim() !== trimmed)
    .join("\n");
  writeFileSync(path, next);
}

const LEGACY_AUTO_REPAIR_BEGIN = "# >>> BEGIN ENTERPRISE-AI-STANDARDS AUTO-REPAIR <<<";
const LEGACY_AUTO_REPAIR_END = "# >>> END ENTERPRISE-AI-STANDARDS AUTO-REPAIR <<<";
const LEGACY_AUTO_REPAIR_HOOKS = ["post-checkout", "post-merge", "post-rewrite"];

function stripManagedBlock(body, begin, end) {
  const lines = body.split("\n");
  const out = [];
  let skipping = false;
  let removed = false;

  for (const line of lines) {
    if (line === begin) {
      skipping = true;
      removed = true;
      continue;
    }
    if (skipping && line === end) {
      skipping = false;
      continue;
    }
    if (!skipping) out.push(line);
  }

  return { removed, body: out.join("\n").replace(/\n{3,}/g, "\n\n") };
}

export function removeLegacyAutoRepairHooks(repoRootDir) {
  const hooksDir = resolve(gitCommonDir(repoRootDir), "hooks");
  const cleaned = [];

  for (const hookName of LEGACY_AUTO_REPAIR_HOOKS) {
    const hookPath = resolve(hooksDir, hookName);
    if (!existsSync(hookPath)) continue;

    const original = readFileSync(hookPath, "utf8");
    const next = stripManagedBlock(original, LEGACY_AUTO_REPAIR_BEGIN, LEGACY_AUTO_REPAIR_END);
    if (!next.removed) continue;

    writeFileSync(hookPath, next.body.replace(/\s+$/u, "") + "\n");
    cleaned.push(hookName);
  }

  return cleaned;
}
