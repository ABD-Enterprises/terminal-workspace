#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isManagedAdapterContent, LOCAL_ADAPTERS } from "../ai-pipeline/adapters.mjs";
import { validateConfig } from "../ai-pipeline/config.mjs";
import { validateSubagentConfigObject } from "./validate-subagent-config.mjs";

const args = process.argv.slice(2);
let repoRoot = process.cwd();
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--repo") repoRoot = resolve(args[++i] || ".");
}

const failures = [];
const infos = [];
const warnings = [];
let loadedConfig = null;

function fail(msg) {
  failures.push(msg);
}

function info(msg) {
  infos.push(msg);
}

function warn(msg) {
  warnings.push(msg);
}

function gitGrep(pattern, pathspecs = []) {
  // git grep exits 1 on no match; treat that as empty.
  // Use -e to ensure patterns starting with `-` or containing flag-like text
  // are not interpreted as options.
  const argv = ["grep", "-nIE", "-e", pattern, "--"];
  if (pathspecs.length) argv.push(...pathspecs);
  else argv.push(":(exclude)tools/validators/enforce-pipeline.mjs");
  const r = spawnSync("git", argv, {
    cwd: repoRoot,
    encoding: "utf8",
  });
  if (r.status > 1) {
    throw new Error(`git ${argv.join(" ")} failed: ${r.stderr}`);
  }
  return (r.stdout || "")
    .split("\n")
    .filter(Boolean);
}

function gitLsFiles(pathspecs) {
  const r = spawnSync("git", ["ls-files", "--", ...pathspecs], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  if (r.status !== 0) {
    throw new Error(`git ls-files failed: ${r.stderr}`);
  }
  return (r.stdout || "")
    .split("\n")
    .filter(Boolean);
}

function splitGitGrepHit(hit) {
  const first = hit.indexOf(":");
  const second = hit.indexOf(":", first + 1);
  if (first === -1 || second === -1) {
    return { path: hit, line: "", content: "" };
  }
  return {
    path: hit.slice(0, first),
    line: hit.slice(first + 1, second),
    content: hit.slice(second + 1),
  };
}

// ---------- check 1: config exists and is valid ----------

const configCandidates = ["ai/config.json", ".ai/config.json"];
const configPath = configCandidates
  .map((c) => resolve(repoRoot, c))
  .find(existsSync);

if (!configPath) {
  fail(
    `No board config found. Expected one of: ${configCandidates.map((p) => p).join(", ")}`,
  );
} else {
  try {
    loadedConfig = JSON.parse(readFileSync(configPath, "utf8"));
    validateConfig(loadedConfig, configPath);
    for (const error of validateSubagentConfigObject(loadedConfig)) {
      fail(`Invalid subagent config: ${error}`);
    }
  } catch (err) {
    fail(`Invalid config: ${err.message}`);
  }
}

// ---------- check 1b: adopted product repos have local agent-discovery adapters ----------

const adoptedProductConfigPath = resolve(repoRoot, ".ai/config.json");
if (configPath === adoptedProductConfigPath) {
  for (const p of gitLsFiles([".ai"])) {
    fail(`tracked local AI adoption file: ${p}`);
  }
  for (const adapter of LOCAL_ADAPTERS) {
    const adapterPath = resolve(repoRoot, adapter.path);
    if (!existsSync(adapterPath)) {
      fail(`missing local agent adapter: ${adapter.path} (run ai-pipeline adopt --force)`);
      continue;
    }
    const content = readFileSync(adapterPath, "utf8");
    if (!isManagedAdapterContent(content)) {
      fail(`unmanaged local agent adapter: ${adapter.path} (run ai-pipeline adopt --force or remove the conflicting file)`);
    }
    // §C2 A36/C36: tracked adapters must carry the EAS contract inline; never
    // by `file://` reference to an operator's local checkout, and never with
    // absolute home paths that only resolve on one machine.
    if (/file:\/\//.test(content)) {
      fail(
        `${adapter.path}: tracked adapter contains a file:// reference (§C2 A36 — adapters carry the EAS contract inline, never by file:// to a local checkout)`,
      );
    }
    if (/(^|[\s'"`(])\/Users\/[A-Za-z0-9._-]+/.test(content)) {
      fail(
        `${adapter.path}: tracked adapter contains a /Users/<operator>/ absolute path (§C2 A36 — operator-local paths break cloud agents and other operators)`,
      );
    }
    if (/(^|[\s'"`(])\/home\/[A-Za-z0-9._-]+/.test(content)) {
      fail(
        `${adapter.path}: tracked adapter contains a /home/<operator>/ absolute path (§C2 A36 — operator-local paths break cloud agents and other operators)`,
      );
    }
  }
}

// ---------- check 2: no committed secrets ----------

const SECRET_PATTERNS = [
  "(ghp_|gho_|ghs_)[A-Za-z0-9]{30,}",
  "github_pat_[A-Za-z0-9]{20,}_[A-Za-z0-9_]{20,}",
  "glpat-[A-Za-z0-9_-]{20,}",
  "lin_api_[A-Za-z0-9]{20,}",
  "AKIA[0-9A-Z]{16}",
  "-----BEGIN (RSA|EC|OPENSSH|PRIVATE) PRIVATE KEY-----",
];

const SECRET_CONTENT_RE = new RegExp(SECRET_PATTERNS.join("|"), "m");
const SECRET_NAME_RE = /(^|[-_./])(secret|token|password|private[-_]?key|credential|api[-_]?key)([-_./]|$)/i;

function isHttpUrl(ref) {
  return /^https?:\/\//i.test(ref);
}

function isRepoRelativePath(ref) {
  if (typeof ref !== "string" || !ref.trim()) return false;
  if (isHttpUrl(ref) || isAbsolute(ref)) return false;
  const normalized = normalize(ref);
  return normalized !== "." && !normalized.startsWith("..") && !normalized.includes("/../");
}

function configuredLocalReviewEvidence(cfg) {
  const localReview = cfg?.local_review;
  if (!localReview?.tools || typeof localReview.tools !== "object") return [];
  const entries = [];
  for (const [toolName, tool] of Object.entries(localReview.tools)) {
    if (!tool || typeof tool !== "object" || tool.enabled !== true) continue;
    const required = localReview.mode === "required" || tool.required === true;
    const evidence = Array.isArray(tool.evidence) ? tool.evidence : [];
    if (required && evidence.length === 0) {
      fail(`local_review.tools.${toolName} is required but declares no evidence paths`);
    }
    for (const ref of evidence) entries.push({ toolName, ref, required });
  }
  return entries;
}

function validateConfiguredLocalReviewEvidence(cfg) {
  const allowedDirs = [
    ...(cfg?.evidence?.allowed_directories || []),
    ...(cfg?.local_review?.allowed_directories || []),
  ];
  for (const entry of configuredLocalReviewEvidence(cfg)) {
    const label = `local_review.tools.${entry.toolName}.evidence`;
    if (typeof entry.ref !== "string" || !entry.ref.trim()) {
      fail(`${label} contains an empty evidence path`);
      continue;
    }
    if (isHttpUrl(entry.ref)) {
      fail(`${label} must be a repo-relative file path, not a URL: ${entry.ref}`);
      continue;
    }
    if (!isRepoRelativePath(entry.ref)) {
      fail(`${label} must stay inside the repo: ${entry.ref}`);
      continue;
    }
    if (SECRET_NAME_RE.test(entry.ref)) {
      fail(`${label} path looks secret-bearing; use a scrubbed report path: ${entry.ref}`);
      continue;
    }
    const inAllowed = allowedDirs.some((dir) =>
      entry.ref.startsWith(dir.endsWith("/") ? dir : `${dir}/`),
    );
    if (allowedDirs.length && !inAllowed) {
      fail(`${label} path "${entry.ref}" must live under one of: ${allowedDirs.join(", ")}`);
      continue;
    }
    const abs = resolve(repoRoot, entry.ref);
    if (!abs.startsWith(resolve(repoRoot) + "/")) {
      fail(`${label} must stay inside the repo: ${entry.ref}`);
      continue;
    }
    if (!existsSync(abs)) {
      fail(`${label} path does not exist: ${entry.ref}`);
      continue;
    }
    const stat = statSync(abs);
    if (!stat.isFile()) {
      fail(`${label} path must be a file: ${entry.ref}`);
      continue;
    }
    if (stat.size === 0) {
      fail(`${label} path is empty: ${entry.ref}`);
      continue;
    }
    const content = readFileSync(abs, "utf8");
    if (SECRET_CONTENT_RE.test(content)) {
      fail(`${label} contains secret-like content: ${entry.ref}`);
    }
  }
}

function isAllowedSecretHit(hit) {
  const { path, content } = splitGitGrepHit(hit);
  const isTestPath = /(^|\/)(test|tests|__tests__)\//.test(path) || /\.(test|spec)\.[A-Za-z0-9]+$/.test(path);
  if (!isTestPath) return false;
  if (!content.includes("PRIVATE KEY")) return false;
  return /\b(expect|assert|toMatch|toContain|XCTAssert|#expect)\b/.test(content);
}

for (const pat of SECRET_PATTERNS) {
  const hits = gitGrep(pat);
  for (const h of hits) {
    if (isAllowedSecretHit(h)) continue;
    fail(`secret-like content: ${h}`);
  }
}

if (loadedConfig) {
  validateConfiguredLocalReviewEvidence(loadedConfig);
}

// ---------- check 3: no unresolved merge markers ----------

for (const marker of ["^<<<<<<< ", "^>>>>>>> "]) {
  const hits = gitGrep(marker);
  for (const h of hits) fail(`merge marker: ${h}`);
}

// ---------- check 4: no machine-local absolute paths in tracked content ----------

const LOCAL_PATH_PATTERNS = [
  "/Users/[A-Za-z0-9_.-]+/",
  "/home/[A-Za-z0-9_.-]+/",
  "C:\\\\\\\\Users\\\\\\\\[A-Za-z0-9_.-]+",
];

const LOCAL_PATH_ALLOWLIST = [
  "/Users/<", // doc placeholder
  "/Users/${", // shell interpolation in docs
  "/Users/example/", // placeholder used in tests and examples
  "/Users/test/", // placeholder used in tests
  "/Users/someone/", // placeholder used in negative-path tests
  "/Users/user/", // placeholder used in docs
  "/Users/runner/", // GitHub-hosted macOS runner path
  "/home/example/", // placeholder used in tests and examples
  "/home/test/", // placeholder used in tests
  "/home/runner/", // GitHub-hosted Linux runner path
  "~/", // machine-neutral form is fine; we don't grep for this
];

for (const pat of LOCAL_PATH_PATTERNS) {
  const hits = gitGrep(pat);
  for (const h of hits) {
    if (LOCAL_PATH_ALLOWLIST.some((a) => h.includes(a))) continue;
    fail(`machine-local absolute path: ${h}`);
  }
}

// ---------- check 5: no references to deleted-pipeline files ----------

const LEGACY_PIPELINE_PATHS = [
  ".ai/bootstrap.md",
  ".ai/work.json",
  ".ai/state.json",
  ".ai/markdown.json",
  ".ai/validate.sh",
  "ai/bootstrap.md",
  "ai/work.json",
  "ai/state.json",
  "ai/markdown.json",
  "ai/validate.sh",
  "ai.config.json",
  "docs/roadmap/markdown.json",
  "docs/roadmap/state.json",
  "docs/issues.md",
  "docs/issue-log.md",
  "docs/findings.md",
  "docs/finding-log.md",
  "issues.md",
  "issue-log.md",
  "state/markdown.json",
  "state/tasks.json",
  "state/risks.json",
  "state/decisions.json",
  "state/env.json",
  "state/repo.json",
  "state/session.json",
  "state/artifacts.json",
  "state/handoff.json",
  "state/controller.md",
  "state/current_task.md",
  "state/implementation_notes.md",
  "state/validation_report.md",
];

for (const p of gitLsFiles(LEGACY_PIPELINE_PATHS)) {
  fail(`tracked legacy pipeline file: ${p}`);
}

const DEAD_REFERENCES = [
  "(^|[^A-Za-z0-9_-])work\\.json([^A-Za-z0-9_-]|$)",
  "(^|[^A-Za-z0-9_-])markdown\\.json([^A-Za-z0-9_-]|$)",
  "docs/roadmap/markdown\\.json",
  "docs/roadmap/state\\.json",
  "(^|/)issues\\.md$",
  "(^|/)issue-log\\.md$",
  "(^|/)findings\\.md$",
  "(^|/)finding-log\\.md$",
  "\\.ai/markdown\\.json",
  "\\.ai/state\\.json",
  "ai/markdown\\.json",
  "ai/state\\.json",
  "state/markdown\\.json",
  "state/(tasks|risks|decisions|env|repo|session|artifacts|handoff)\\.json",
  "ai/bootstrap\\.md",
  "ai/validate\\.sh",
  "enforce-runtime-guardrails",
  "ai-pipeline\\.sh",
  "scaffold-long-running-repo",
  "sync-standards-to-repo",
  "refresh-adopted-repos",
  "get-latest-ai-repos",
  "migrate-public-repo-to-local-overlay",
  "audit-public-ai-footprint",
  "runtime-injection\\.manifest\\.json",
  "human-readable roadmap companion to \\[state\\.json\\]",
  "canonical execution contract across roadmap, shared state",
  "docs/roadmap/roadmap\\.md`: current milestone and next phase",
];

const DEAD_REF_ALLOW = [
  // History.
  "CHANGELOG.md",
  // Released-version archive (extracted from CHANGELOG.md per the
  // token-leak reduction). Historical release notes legitimately
  // mention retired pipeline surfaces; the archive is read-only history.
  "CHANGELOG-archive.md",
  // Entry-point docs explain the new contract by contrast to the old.
  "enterprise-ai-standards.md",
  "README.md",
  "AGENTS.md",
  "CLAUDE.md",
  ".agent/rules.md",
  // This validator names them by definition.
  "tools/ai-pipeline/adapters.mjs",
  "tools/validators/enforce-pipeline.mjs",
  "tools/validators/test-enforce-pipeline.mjs",
];

const seenDeadRefHits = new Set();
for (const pat of DEAD_REFERENCES) {
  const hits = gitGrep(pat);
  for (const h of hits) {
    if (seenDeadRefHits.has(h)) continue;
    seenDeadRefHits.add(h);
    const path = h.split(":", 1)[0];
    if (DEAD_REF_ALLOW.some((a) => path === a || path.startsWith(`${a}/`))) continue;
    fail(`reference to deleted-pipeline file: ${h}`);
  }
}

// ---------- check 6: sanctioned-workflow pin state ----------
//
// Consumer repos may adopt the reusable workflows shipped under
// `.github/workflows/reusable/` in this EAS repo. The stub files committed
// to the consumer's tree are named `.github/workflows/eas-*.yml` and contain
// a `uses:` line pointing at this repo at a pinned version. The validator
// reads EAS's own version (the standards checkout this validator ships from)
// and compares each consumer pin against it. See Section 17.

const EAS_REPO_REF = "ABD-Enterprises/enterprise-ai-standards";
const VALIDATOR_DIR = dirname(fileURLToPath(import.meta.url));
const EAS_ROOT = resolve(VALIDATOR_DIR, "..", "..");

function readEasVersion() {
  // Match what enforce-versioning-standard.mjs treats as canonical: take the
  // first version source it can find. EAS itself uses CHANGELOG.md as the
  // authoritative repo-level version source; fall back to the latest git tag
  // if CHANGELOG isn't present.
  const changelog = resolve(EAS_ROOT, "CHANGELOG.md");
  if (existsSync(changelog)) {
    const content = readFileSync(changelog, "utf8");
    const match = content.match(
      /^##\s+\[?v?(\d+)\.(\d+)\.(\d+)(?:-(?:alpha|beta|rc)\.\d+)?(?:\+build\.\d+)?\]?/m,
    );
    if (match) {
      return {
        major: Number(match[1]),
        minor: Number(match[2]),
        patch: Number(match[3]),
        raw: `${match[1]}.${match[2]}.${match[3]}`,
      };
    }
  }
  try {
    const r = spawnSync("git", ["tag", "--list", "v*", "--sort=-v:refname"], {
      cwd: EAS_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const tag = (r.stdout || "")
      .split(/\r?\n/)
      .map((s) => s.trim())
      .find(Boolean);
    const tm = tag && tag.match(/^v(\d+)\.(\d+)\.(\d+)/);
    if (tm) {
      return {
        major: Number(tm[1]),
        minor: Number(tm[2]),
        patch: Number(tm[3]),
        raw: `${tm[1]}.${tm[2]}.${tm[3]}`,
      };
    }
  } catch {
    /* ignore */
  }
  return null;
}

function listEasStubWorkflows() {
  const wfDir = resolve(repoRoot, ".github/workflows");
  if (!existsSync(wfDir)) return [];
  let entries;
  try {
    entries = readdirSync(wfDir);
  } catch {
    return [];
  }
  return entries
    .filter((name) => /^eas-.+\.ya?ml$/.test(name))
    .map((name) => ({ name, path: resolve(wfDir, name) }));
}

function extractUsesPin(content) {
  // The stub file has at least one `uses:` referencing the EAS reusable
  // workflow. We look for the EAS-owned path; any other `uses:` is ignored.
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(
      /\buses:\s*([^\s#]+)/,
    );
    if (!m) continue;
    const ref = m[1].trim();
    if (!ref.includes(`${EAS_REPO_REF}/.github/workflows/reusable/`)) continue;
    const at = ref.lastIndexOf("@");
    if (at === -1) return { ref, version: null };
    return { ref, version: ref.slice(at + 1) };
  }
  return null;
}

function parsePinVersion(version) {
  if (!version) return null;
  if (/^(main|HEAD|master)$/i.test(version)) return { floating: true };
  const m = version.match(
    /^v?(\d+)\.(\d+)\.(\d+)(?:-(?:alpha|beta|rc)\.\d+)?(?:\+build\.\d+)?$/,
  );
  if (!m) return null;
  return {
    floating: false,
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
  };
}

const easVersion = readEasVersion();
const stubs = listEasStubWorkflows();
if (stubs.length && easVersion) {
  for (const stub of stubs) {
    const content = readFileSync(stub.path, "utf8");
    const uses = extractUsesPin(content);
    if (!uses) {
      // Stub doesn't reference the EAS reusable library at all; not our
      // contract to enforce — consumer may have repurposed the filename.
      continue;
    }
    const parsed = parsePinVersion(uses.version);
    if (!parsed) {
      fail(
        `${stub.name} reusable-workflow pin missing or unrecognized: "${uses.ref}". Pin to @v<MAJOR>.<MINOR>.<PATCH>.`,
      );
      continue;
    }
    if (parsed.floating) {
      fail(
        `${stub.name} reusable-workflow pin is floating ("@${uses.version}"). Pin to @v<MAJOR>.<MINOR>.<PATCH>.`,
      );
      continue;
    }
    const pinned = `v${parsed.major}.${parsed.minor}.${parsed.patch}`;
    const current = `v${easVersion.major}.${easVersion.minor}.${easVersion.patch}`;
    if (
      parsed.major === easVersion.major &&
      parsed.minor === easVersion.minor &&
      parsed.patch === easVersion.patch
    ) {
      continue; // match — silent
    }
    if (parsed.major < easVersion.major) {
      warn(
        `${stub.name} pinned to ${pinned}; ${current} is current (MAJOR bump — consumer may have valid reasons to defer)`,
      );
      continue;
    }
    if (parsed.major > easVersion.major) {
      // Consumer pinned ahead of the validator's own EAS version — likely a
      // stale validator, not a stale stub. Surface as INFO.
      info(
        `${stub.name} pinned to ${pinned}; this EAS checkout is ${current} (validator may be behind)`,
      );
      continue;
    }
    // Same major; behind on minor or patch.
    info(`${stub.name} pinned to ${pinned}; ${current} is current`);
  }
}

// ---------- report ----------

for (const m of infos) console.log(`[enforce-pipeline] INFO: ${m}`);
for (const m of warnings) console.warn(`[enforce-pipeline] WARN: ${m}`);

if (failures.length) {
  console.error(`[enforce-pipeline] ${failures.length} failure(s):`);
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("[enforce-pipeline] OK");
