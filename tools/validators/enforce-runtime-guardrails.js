#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const REQUIRED_STATE_FILES = [
  "docs/roadmap/state.json",
  "state/tasks.json",
  "state/risks.json",
  "state/artifacts.json",
  "state/handoff.json"
];
const REQUIRED_WORKFLOW_FILES = [
  "ai/bootstrap.md",
  "ai/plan.md",
  "ai/tasks.md",
  "ai/acceptance.md",
  "state/controller.md",
  "state/current_task.md",
  "state/implementation_notes.md",
  "state/validation_report.md"
];
const REQUIRED_REPO_FILES = [
  ...REQUIRED_STATE_FILES,
  ...REQUIRED_WORKFLOW_FILES
];

const STATE_UPDATE_FILES = new Set([
  "state/tasks.json",
  "state/risks.json",
  "state/artifacts.json",
  "state/handoff.json"
]);
const DEFAULT_EVIDENCE_DIRECTORIES = ["artifacts/"];
const DEFAULT_META_DIRECTORIES = [];
const DEFAULT_PROTECTED_ENVIRONMENT_PATHS = ["brew/"];
const DEFAULT_RUN_PROFILE = "standard";
const DEFAULT_ALLOWED_METADATA_ONLY_EVIDENCE_TYPES = [
  "build",
  "test",
  "run",
  "deploy"
];
const SAFE_SUPPORTING_ARTIFACT_EXTENSIONS = new Set([
  ".log",
  ".txt",
  ".json",
  ".xml",
  ".csv",
  ".md",
  ".html",
  ".sarif",
  ".out"
]);
const ALLOWED_CONFIG_KEYS = new Set([
  "run_profile",
  "requires_test_evidence",
  "requires_deploy_evidence",
  "allowed_phases_without_tests",
  "strict_mode",
  "protected_environment_paths",
  "evidence_directories",
  "meta_directories",
  "allowed_metadata_only_evidence_types",
  "auto_merge"
]);
const ALLOWED_EXTERNAL_INPUT_LAYERS = new Set([
  "environment",
  "control"
]);
const BREWSYNC_EXTERNAL_KINDS = new Set([
  "plan",
  "inventory",
  "drift",
  "apply",
  "verify",
  "log"
]);

const DOC_PATTERNS = [
  /^docs\//,
  /^README\.md$/,
  /^CHANGELOG\.md$/,
  /^LICENSE$/,
  /\.md$/,
  /\.mdx$/,
  /\.txt$/,
  /\.rst$/,
  /\.adoc$/
];

const STATE_OR_META_PATTERNS = [
  /^ai\//,
  /^state\//,
  /^docs\/roadmap\/state\.json$/,
  /^docs\/roadmap\/roadmap\.md$/,
  /^ai\.config\.json$/,
  /^bootstrap\.sh$/,
  /^scripts\/validate\.sh$/,
  /^\.github\/workflows\//
];

const FRONTEND_FILE_PATTERNS = [
  /\.tsx$/,
  /\.jsx$/,
  /\.vue$/,
  /\.svelte$/,
  /\.css$/,
  /\.scss$/,
  /\.less$/
];

function isFrontendFile(relativePath) {
  return FRONTEND_FILE_PATTERNS.some((pattern) => pattern.test(relativePath));
}

const EVIDENCE_KEYS = ["build", "test", "run", "deploy"];
const ALLOWED_EVIDENCE_STATUSES = new Set([
  "passed",
  "failed",
  "not_run",
  "blocked",
  "not_required"
]);
const ALLOWED_CLAIM_STATUSES = new Set([
  "not_started",
  "in_progress",
  "complete"
]);
const ALLOWED_PHASE_TYPES = new Set([
  "planning",
  "docs",
  "build",
  "infra",
  "deploy"
]);
const ALLOWED_PHASE_STATUSES = new Set([
  "planned",
  "in_progress",
  "blocked",
  "complete"
]);
const ALLOWED_RUN_PROFILES = new Set(["standard", "night"]);
const ALLOWED_CONTROLLER_STATES = new Set([
  "ready_for_claude",
  "ready_for_codex",
  "ready_for_review",
  "review_failed_fix_required",
  "blocked",
  "done"
]);
const RESOLVED_RISK_STATUSES = new Set(["resolved", "closed"]);

function parseArgs(argv) {
  const options = {
    repo: process.cwd(),
    config: null,
    base: process.env.AI_VALIDATOR_BASE_REF || process.env.GITHUB_BASE_SHA || null
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];

    if (value === "--repo") {
      index += 1;
      options.repo = argv[index];
    } else if (value === "--config") {
      index += 1;
      options.config = argv[index];
    } else if (value === "--base") {
      index += 1;
      options.base = argv[index];
    } else if (value === "-h" || value === "--help") {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${value}`);
    }
  }

  return options;
}

function printUsage() {
  process.stdout.write(`Usage:
  node tools/validators/enforce-runtime-guardrails.js [--repo PATH] [--config PATH] [--base GIT_REF]
`);
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function exists(filePath) {
  return fs.existsSync(filePath);
}

function isDirectory(filePath) {
  try {
    return fs.statSync(filePath).isDirectory();
  } catch {
    return false;
  }
}

function runGit(repoRoot, args, options = {}) {
  try {
    return execFileSync("git", args, {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      ...options
    }).trim();
  } catch {
    return "";
  }
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function normalizePhaseType(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) {
    return "";
  }

  if (raw.includes("plan")) return "planning";
  if (raw.includes("doc")) return "docs";
  if (raw.includes("deploy") || raw.includes("release")) return "deploy";
  if (raw.includes("infra") || raw.includes("config")) return "infra";
  return raw;
}

function normalizeRunProfile(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized || DEFAULT_RUN_PROFILE;
}

function normalizeRepoRelativePath(value) {
  if (typeof value !== "string" || !value.trim()) {
    return "";
  }

  return value.trim().replaceAll("\\", "/");
}

function normalizeProtectedEnvironmentPath(value) {
  const normalized = normalizeRepoRelativePath(value);
  if (!normalized) {
    return "";
  }

  if (
    path.isAbsolute(normalized) ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.includes("/../")
  ) {
    return "";
  }

  return normalized.endsWith("/") ? normalized : `${normalized}/`;
}

function normalizeDirectoryPrefix(value) {
  return normalizeProtectedEnvironmentPath(value);
}

function toRelative(repoRoot, targetPath) {
  return path.relative(repoRoot, targetPath).replaceAll(path.sep, "/");
}

function isDocFile(relativePath) {
  return DOC_PATTERNS.some((pattern) => pattern.test(relativePath));
}

function isStateOrMetaFile(relativePath) {
  return STATE_OR_META_PATTERNS.some((pattern) => pattern.test(relativePath));
}

function pathMatchesPrefixList(relativePath, prefixes) {
  const normalized = normalizeRepoRelativePath(relativePath);
  return prefixes.some((prefix) => normalized.startsWith(prefix));
}

function isConfiguredSupportingArtifactPath(relativePath, config) {
  if (!config) {
    return false;
  }

  return pathMatchesPrefixList(relativePath, [
    ...config.evidence_directories,
    ...config.meta_directories
  ]);
}

function isSupportingArtifactFile(relativePath, config) {
  if (!config) {
    return false;
  }

  const normalized = normalizeRepoRelativePath(relativePath);
  if (!isConfiguredSupportingArtifactPath(normalized, config)) {
    return false;
  }

  const extension = path.extname(normalized).toLowerCase();
  return SAFE_SUPPORTING_ARTIFACT_EXTENSIONS.has(extension);
}

function isCodeOrConfigChange(relativePath, config) {
  return (
    !isDocFile(relativePath) &&
    !isStateOrMetaFile(relativePath) &&
    !isSupportingArtifactFile(relativePath, config)
  );
}

function isRepoRelativeArtifactPath(value) {
  const normalized = normalizeRepoRelativePath(value);
  if (!normalized) {
    return false;
  }

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(normalized)) {
    return false;
  }

  if (normalized.startsWith("file:")) {
    return false;
  }

  if (path.isAbsolute(normalized)) {
    return false;
  }

  if (
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.includes("/../")
  ) {
    return false;
  }

  return true;
}

function validateArtifactPaths(repoRoot, paths, label, failures) {
  if (!Array.isArray(paths)) {
    addFailure(failures, `${label} must be an array`);
    return;
  }

  for (const artifactPath of paths) {
    if (!isRepoRelativeArtifactPath(artifactPath)) {
      addFailure(
        failures,
        `${label} must contain only repo-relative artifact paths`
      );
      continue;
    }

    const absoluteArtifactPath = path.resolve(
      repoRoot,
      normalizeRepoRelativePath(artifactPath)
    );

    if (!absoluteArtifactPath.startsWith(`${repoRoot}${path.sep}`) && absoluteArtifactPath !== repoRoot) {
      addFailure(
        failures,
        `${label} must not point outside the repository`
      );
      continue;
    }

    if (!exists(absoluteArtifactPath) || isDirectory(absoluteArtifactPath)) {
      addFailure(
        failures,
        `${label} references missing evidence file: ${artifactPath}`
      );
      continue;
    }

    const size = fs.statSync(absoluteArtifactPath).size;
    if (size === 0) {
      addFailure(
        failures,
        `${label} references empty evidence file: ${artifactPath}`
      );
    }
  }
}

function listFilesRecursively(root, current = "") {
  const absolute = current ? path.join(root, current) : root;
  const files = [];

  for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
    const relativePath = current ? `${current}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...listFilesRecursively(root, relativePath));
    } else {
      files.push(relativePath);
    }
  }

  return files;
}

function resolveConfig(repoRoot, configArg) {
  const shippedConfig = path.resolve(__dirname, "../../templates/ai.config.json");
  const candidates = [];

  if (configArg) {
    candidates.push(path.resolve(repoRoot, configArg));
  }

  candidates.push(path.join(repoRoot, "ai.config.json"));
  candidates.push(path.join(repoRoot, "templates/ai.config.json"));
  candidates.push(shippedConfig);

  const configPath = candidates.find((candidate) => exists(candidate));
  if (!configPath) {
    throw new Error("Missing ai.config.json. Copy templates/ai.config.json into the repo or pass --config.");
  }

  const config = readJsonFile(configPath);
  const normalizedRunProfile = normalizeRunProfile(config.run_profile);
  const hasConfiguredEvidenceDirectories = Object.prototype.hasOwnProperty.call(
    config,
    "evidence_directories"
  );
  const hasConfiguredMetaDirectories = Object.prototype.hasOwnProperty.call(
    config,
    "meta_directories"
  );
  const hasConfiguredProtectedEnvironmentPaths = Object.prototype.hasOwnProperty.call(
    config,
    "protected_environment_paths"
  );
  const hasConfiguredMetadataOnlyEvidenceTypes = Object.prototype.hasOwnProperty.call(
    config,
    "allowed_metadata_only_evidence_types"
  );
  const unknownKeys = Object.keys(config).filter(
    (key) => !ALLOWED_CONFIG_KEYS.has(key)
  );
  const providedEvidenceDirectories = hasConfiguredEvidenceDirectories && Array.isArray(config.evidence_directories)
    ? config.evidence_directories
    : [];
  const providedMetaDirectories = hasConfiguredMetaDirectories && Array.isArray(config.meta_directories)
    ? config.meta_directories
    : [];
  const providedProtectedEnvironmentPaths = hasConfiguredProtectedEnvironmentPaths && Array.isArray(config.protected_environment_paths)
    ? config.protected_environment_paths
    : [];
  const providedMetadataOnlyEvidenceTypes = hasConfiguredMetadataOnlyEvidenceTypes && Array.isArray(config.allowed_metadata_only_evidence_types)
    ? config.allowed_metadata_only_evidence_types
    : [];
  const invalidEvidenceDirectories = providedEvidenceDirectories.filter(
    (value) => !normalizeDirectoryPrefix(value)
  );
  const invalidMetaDirectories = providedMetaDirectories.filter(
    (value) => !normalizeDirectoryPrefix(value)
  );
  const invalidProtectedEnvironmentPaths = providedProtectedEnvironmentPaths.filter(
    (value) => !normalizeProtectedEnvironmentPath(value)
  );
  const invalidMetadataOnlyEvidenceTypes = providedMetadataOnlyEvidenceTypes.filter(
    (value) => !EVIDENCE_KEYS.includes(String(value || "").trim().toLowerCase())
  );

  if (unknownKeys.length > 0) {
    throw new Error(
      `ai.config.json contains unsupported keys: ${unknownKeys.join(", ")}`
    );
  }

  if (!ALLOWED_RUN_PROFILES.has(normalizedRunProfile)) {
    throw new Error(
      `ai.config.json run_profile must be one of ${[...ALLOWED_RUN_PROFILES].join(", ")}`
    );
  }

  if (hasConfiguredEvidenceDirectories && !Array.isArray(config.evidence_directories)) {
    throw new Error("ai.config.json evidence_directories must be an array");
  }

  if (hasConfiguredMetaDirectories && !Array.isArray(config.meta_directories)) {
    throw new Error("ai.config.json meta_directories must be an array");
  }

  if (
    hasConfiguredProtectedEnvironmentPaths &&
    !Array.isArray(config.protected_environment_paths)
  ) {
    throw new Error("ai.config.json protected_environment_paths must be an array");
  }

  if (
    hasConfiguredMetadataOnlyEvidenceTypes &&
    !Array.isArray(config.allowed_metadata_only_evidence_types)
  ) {
    throw new Error("ai.config.json allowed_metadata_only_evidence_types must be an array");
  }

  if (invalidProtectedEnvironmentPaths.length > 0) {
    throw new Error(
      `ai.config.json contains invalid protected_environment_paths: ${invalidProtectedEnvironmentPaths.join(", ")}`
    );
  }

  if (invalidEvidenceDirectories.length > 0) {
    throw new Error(
      `ai.config.json contains invalid evidence_directories: ${invalidEvidenceDirectories.join(", ")}`
    );
  }

  if (invalidMetaDirectories.length > 0) {
    throw new Error(
      `ai.config.json contains invalid meta_directories: ${invalidMetaDirectories.join(", ")}`
    );
  }

  if (invalidMetadataOnlyEvidenceTypes.length > 0) {
    throw new Error(
      `ai.config.json contains invalid allowed_metadata_only_evidence_types: ${invalidMetadataOnlyEvidenceTypes.join(", ")}`
    );
  }

  return {
    path: configPath,
    value: {
      run_profile: normalizedRunProfile,
      requires_test_evidence: config.requires_test_evidence !== false,
      requires_deploy_evidence: config.requires_deploy_evidence !== false,
      allowed_phases_without_tests: Array.isArray(config.allowed_phases_without_tests)
        ? config.allowed_phases_without_tests.map((value) => normalizePhaseType(value))
        : ["planning", "docs"],
      strict_mode: config.strict_mode !== false,
      evidence_directories: unique(
        (hasConfiguredEvidenceDirectories
          ? providedEvidenceDirectories
          : DEFAULT_EVIDENCE_DIRECTORIES
        )
          .map((value) => normalizeDirectoryPrefix(value))
          .filter(Boolean)
      ),
      meta_directories: unique(
        (hasConfiguredMetaDirectories
          ? providedMetaDirectories
          : DEFAULT_META_DIRECTORIES
        )
          .map((value) => normalizeDirectoryPrefix(value))
          .filter(Boolean)
      ),
      protected_environment_paths: unique(
        (hasConfiguredProtectedEnvironmentPaths
          ? providedProtectedEnvironmentPaths
          : [
              ...DEFAULT_PROTECTED_ENVIRONMENT_PATHS,
              ...providedProtectedEnvironmentPaths
            ]
        )
          .map((value) => normalizeProtectedEnvironmentPath(value))
          .filter(Boolean)
      ),
      allowed_metadata_only_evidence_types: unique(
        (hasConfiguredMetadataOnlyEvidenceTypes
          ? providedMetadataOnlyEvidenceTypes
          : DEFAULT_ALLOWED_METADATA_ONLY_EVIDENCE_TYPES
        )
          .map((value) => String(value || "").trim().toLowerCase())
          .filter((value) => EVIDENCE_KEYS.includes(value))
      )
    }
  };
}

function resolveBaseRef(repoRoot, explicitBase) {
  if (explicitBase) {
    return explicitBase;
  }

  const githubBaseRef = process.env.GITHUB_BASE_REF;
  if (githubBaseRef) {
    const remoteRef = `origin/${githubBaseRef}`;
    const mergeBase = runGit(repoRoot, ["merge-base", "HEAD", remoteRef]);
    if (mergeBase) {
      return mergeBase;
    }
  }

  const previousHead = runGit(repoRoot, ["rev-parse", "HEAD~1"]);
  return previousHead || null;
}

function getChangedFiles(repoRoot, baseRef) {
  const args = baseRef
    ? ["diff", "--name-only", "--diff-filter=ACMR", `${baseRef}...HEAD`]
    : ["diff", "--name-only", "--diff-filter=ACMR", "HEAD"];

  const committedOrWorkingTree = runGit(repoRoot, args)
    .split("\n")
    .map((value) => value.trim())
    .filter(Boolean);

  const staged = runGit(repoRoot, [
    "diff",
    "--name-only",
    "--diff-filter=ACMR",
    "--cached"
  ])
    .split("\n")
    .map((value) => value.trim())
    .filter(Boolean);

  const unstaged = runGit(repoRoot, [
    "diff",
    "--name-only",
    "--diff-filter=ACMR"
  ])
    .split("\n")
    .map((value) => value.trim())
    .filter(Boolean);

  const untracked = runGit(repoRoot, [
    "ls-files",
    "--others",
    "--exclude-standard"
  ])
    .split("\n")
    .map((value) => value.trim())
    .filter(Boolean);

  return unique([...committedOrWorkingTree, ...staged, ...unstaged, ...untracked]);
}

function readJsonAtGitRef(repoRoot, ref, relativePath) {
  if (!ref) {
    return null;
  }

  const content = runGit(repoRoot, ["show", `${ref}:${relativePath}`]);
  if (!content) {
    return null;
  }

  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

function addFailure(failures, message) {
  if (!failures.includes(message)) {
    failures.push(message);
  }
}

function readTextFile(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function extractMarkdownField(content, fieldName) {
  const pattern = new RegExp(`^${fieldName}:\\s*(.+)$`, "mi");
  const match = content.match(pattern);
  return match ? match[1].trim() : "";
}

function getRepoVisibleFiles(repoRoot) {
  const fromGit = runGit(repoRoot, [
    "ls-files",
    "--cached",
    "--others",
    "--exclude-standard"
  ])
    .split("\n")
    .map((value) => normalizeRepoRelativePath(value))
    .filter(Boolean);

  if (fromGit.length > 0) {
    return unique(fromGit);
  }

  return listFilesRecursively(repoRoot).map((value) => normalizeRepoRelativePath(value));
}

function pathMatchesProtectedEnvironmentPath(relativePath, protectedPaths) {
  const normalized = normalizeRepoRelativePath(relativePath);
  return protectedPaths.some((protectedPath) => normalized.startsWith(protectedPath));
}

function validateRequiredFiles(repoRoot, failures) {
  for (const relativePath of REQUIRED_REPO_FILES) {
    const absolutePath = path.join(repoRoot, relativePath);
    if (!exists(absolutePath)) {
      const label = REQUIRED_WORKFLOW_FILES.includes(relativePath)
        ? "workflow file"
        : "state file";
      addFailure(
        failures,
        `Missing required ${label}: ${relativePath}; validator does not infer missing execution contract inputs from chat memory, BrewSync, machine state, or control layers`
      );
    }
  }
}

function validateWorkflowFiles(repoRoot, failures) {
  for (const relativePath of REQUIRED_WORKFLOW_FILES) {
    const absolutePath = path.join(repoRoot, relativePath);
    if (!exists(absolutePath) || isDirectory(absolutePath)) {
      continue;
    }

    const content = readTextFile(absolutePath).trim();
    if (!content) {
      addFailure(failures, `Required workflow file is empty: ${relativePath}`);
      continue;
    }

    if (relativePath === "state/controller.md") {
      const state = extractMarkdownField(content, "current_state")
        || extractMarkdownField(content, "state")
        || extractMarkdownField(content, "status");
      if (!ALLOWED_CONTROLLER_STATES.has(state)) {
        addFailure(
          failures,
          `state/controller.md state must be one of ${[...ALLOWED_CONTROLLER_STATES].join(", ")}`
        );
      }
    }
  }
}

function validateLayerBoundaryViolations(repoRoot, changedFiles, config, failures) {
  const protectedPaths = config.protected_environment_paths;
  const ownedProtectedFiles = getRepoVisibleFiles(repoRoot).filter((relativePath) =>
    pathMatchesProtectedEnvironmentPath(relativePath, protectedPaths)
  );

  if (ownedProtectedFiles.length > 0) {
    addFailure(
      failures,
      `Execution repo must not own protected environment-layer paths: ${ownedProtectedFiles.join(", ")}`
    );
  }

  const changedProtectedFiles = changedFiles.filter((relativePath) =>
    pathMatchesProtectedEnvironmentPath(relativePath, protectedPaths)
  );

  if (changedProtectedFiles.length > 0) {
    addFailure(
      failures,
      `Execution repo must not change protected environment-layer paths: ${changedProtectedFiles.join(", ")}`
    );
  }

  const changedSupportingArtifacts = changedFiles.filter((relativePath) =>
    isConfiguredSupportingArtifactPath(relativePath, config)
  );
  const hiddenExecutionFiles = changedSupportingArtifacts.filter(
    (relativePath) => !isSupportingArtifactFile(relativePath, config)
  );

  if (hiddenExecutionFiles.length > 0) {
    addFailure(
      failures,
      `Supporting artifact directories contain execution-like files: ${hiddenExecutionFiles.join(", ")}`
    );
  }
}

function validateRoadmapState(roadmap, tasks, failures) {
  const requiredFields = [
    "current_phase",
    "phase_type",
    "phase_status",
    "active_task_id",
    "last_updated"
  ];

  for (const field of requiredFields) {
    if (!roadmap[field]) {
      addFailure(failures, `docs/roadmap/state.json missing required field: ${field}`);
    }
  }

  const normalizedPhaseType = normalizePhaseType(roadmap.phase_type);
  if (!ALLOWED_PHASE_TYPES.has(normalizedPhaseType)) {
    addFailure(
      failures,
      `docs/roadmap/state.json has unsupported phase_type: ${roadmap.phase_type}`
    );
  }

  if (!ALLOWED_PHASE_STATUSES.has(String(roadmap.phase_status || ""))) {
    addFailure(
      failures,
      `docs/roadmap/state.json has unsupported phase_status: ${roadmap.phase_status}`
    );
  }

  if (!Array.isArray(tasks.tasks)) {
    addFailure(failures, "state/tasks.json must contain a tasks array");
    return;
  }

  const activeTask = tasks.tasks.find((task) => task.id === roadmap.active_task_id);
  if (!activeTask) {
    addFailure(
      failures,
      `Active task ${roadmap.active_task_id || "<missing>"} is not present in state/tasks.json`
    );
  }
}

function validateEvidenceStructure(repoRoot, artifacts, config, failures) {
  if (!artifacts.last_updated) {
    addFailure(failures, "state/artifacts.json missing required field: last_updated");
  }

  if (typeof artifacts.code_changes_present !== "boolean") {
    addFailure(
      failures,
      "state/artifacts.json code_changes_present must be a boolean"
    );
  }

  if (!artifacts.claims || typeof artifacts.claims !== "object") {
    addFailure(failures, "state/artifacts.json missing claims object");
  } else {
    for (const claim of ["implementation", "validation", "deployment"]) {
      if (!ALLOWED_CLAIM_STATUSES.has(String(artifacts.claims[claim] || ""))) {
        addFailure(
          failures,
          `state/artifacts.json claims.${claim} must be one of ${[...ALLOWED_CLAIM_STATUSES].join(", ")}`
        );
      }
    }
  }

  if (!artifacts.evidence || typeof artifacts.evidence !== "object") {
    addFailure(failures, "state/artifacts.json missing evidence object");
    return;
  }

  for (const key of EVIDENCE_KEYS) {
    const entry = artifacts.evidence[key];
    if (!entry || typeof entry !== "object") {
      addFailure(failures, `state/artifacts.json missing evidence bucket: ${key}`);
      continue;
    }

    if (!ALLOWED_EVIDENCE_STATUSES.has(String(entry.status || ""))) {
      addFailure(
        failures,
        `state/artifacts.json evidence.${key}.status must be one of ${[...ALLOWED_EVIDENCE_STATUSES].join(", ")}`
      );
    }

    if (!entry.updated_at) {
      addFailure(failures, `state/artifacts.json evidence.${key}.updated_at is required`);
    }

    const label = `state/artifacts.json evidence.${key}`;
    const metadataOnly = entry.metadata_only === true;
    const metadataOnlyAllowed = config.allowed_metadata_only_evidence_types.includes(key);
    const status = String(entry.status || "");
    const requiresFileBackedEvidence = ["passed", "failed"].includes(status);

    if (!Object.prototype.hasOwnProperty.call(entry, "paths")) {
      addFailure(failures, `${label}.paths is required`);
    } else if (!Array.isArray(entry.paths)) {
      addFailure(failures, `${label}.paths must be an array`);
    } else if (entry.paths.length === 0) {
      if (!metadataOnly) {
        addFailure(
          failures,
          `${label}.paths must contain at least one file path or explicitly declare metadata_only=true`
        );
        if (requiresFileBackedEvidence) {
          addFailure(
            failures,
            `${label} with status ${status} requires backing files`
          );
        }
      } else if (!metadataOnlyAllowed) {
        addFailure(
          failures,
          `${label}.metadata_only is not allowed by config`
        );
      } else if (requiresFileBackedEvidence) {
        addFailure(
          failures,
          `${label} with status ${status} requires backing files`
        );
      }
    }

    if (metadataOnly && !metadataOnlyAllowed) {
      addFailure(
        failures,
        `${label}.metadata_only is not allowed by config`
      );
    }

    if (metadataOnly && requiresFileBackedEvidence) {
      addFailure(
        failures,
        `${label} with status ${status} cannot be metadata_only`
      );
    }

    if (Array.isArray(entry.paths) && entry.paths.length > 0) {
      validateArtifactPaths(
        repoRoot,
        entry.paths,
        `${label}.paths`,
        failures
      );
    }

    if (
      ["failed", "not_run", "blocked", "not_required"].includes(String(entry.status || "")) &&
      !String(entry.reason || "").trim()
    ) {
      addFailure(
        failures,
        `state/artifacts.json evidence.${key}.reason is required when status is ${entry.status}`
      );
    }
  }

  if (artifacts.external_inputs !== undefined) {
    if (!Array.isArray(artifacts.external_inputs)) {
      addFailure(
        failures,
        "state/artifacts.json external_inputs must be an array when present"
      );
    } else {
      for (const [index, input] of artifacts.external_inputs.entries()) {
        if (!input || typeof input !== "object") {
          addFailure(
            failures,
            `state/artifacts.json external_inputs[${index}] must be an object`
          );
          continue;
        }

        const layer = String(input.layer || "").trim().toLowerCase();
        if (!ALLOWED_EXTERNAL_INPUT_LAYERS.has(layer)) {
          addFailure(
            failures,
            `state/artifacts.json external_inputs[${index}].layer must be environment or control`
          );
        }

        if (!String(input.source || "").trim()) {
          addFailure(
            failures,
            `state/artifacts.json external_inputs[${index}].source is required`
          );
        }

        if (!String(input.kind || "").trim()) {
          addFailure(
            failures,
            `state/artifacts.json external_inputs[${index}].kind is required`
          );
        }

        if (String(input.source || "").trim().toLowerCase() === "brewsync") {
          const kind = String(input.kind || "").trim().toLowerCase();
          if (!BREWSYNC_EXTERNAL_KINDS.has(kind)) {
            addFailure(
              failures,
              `state/artifacts.json external_inputs[${index}].kind must be one of ${[...BREWSYNC_EXTERNAL_KINDS].join(", ")} for BrewSync`
            );
          }
        }

        if (input.reference_only !== true) {
          addFailure(
            failures,
            `state/artifacts.json external_inputs[${index}].reference_only must be true`
          );
        }

        if (!Object.prototype.hasOwnProperty.call(input, "paths")) {
          addFailure(
            failures,
            `state/artifacts.json external_inputs[${index}].paths is required`
          );
        } else if (!Array.isArray(input.paths)) {
          addFailure(
            failures,
            `state/artifacts.json external_inputs[${index}].paths must be an array`
          );
        } else if (input.paths.length === 0) {
          addFailure(
            failures,
            `state/artifacts.json external_inputs[${index}].paths must contain at least one file path`
          );
        } else {
          validateArtifactPaths(
            repoRoot,
            input.paths,
            `state/artifacts.json external_inputs[${index}].paths`,
            failures
          );
        }
      }
    }
  }
}

function validateRiskAndHandoffState(risks, handoff, failures) {
  if (!Array.isArray(risks.risks)) {
    addFailure(failures, "state/risks.json must contain a risks array");
  }

  if (!risks.last_updated) {
    addFailure(failures, "state/risks.json missing required field: last_updated");
  }

  if (!handoff.last_updated) {
    addFailure(failures, "state/handoff.json missing required field: last_updated");
  }

  if (!String(handoff.summary || "").trim()) {
    addFailure(failures, "state/handoff.json summary is required");
  }

  if (!String(handoff.next_action || "").trim()) {
    addFailure(failures, "state/handoff.json next_action is required");
  }

  if (!Array.isArray(handoff.discovered_issues)) {
    addFailure(failures, "state/handoff.json discovered_issues must be an array");
  }
}

function validateDecisions(decisions, failures) {
  if (!decisions.last_updated) {
    addFailure(failures, "state/decisions.json missing required field: last_updated");
  }

  if (!Array.isArray(decisions.decisions)) {
    addFailure(failures, "state/decisions.json must contain a decisions array");
  }
}

function validateDiffAwareState(
  changedFiles,
  baseRoadmap,
  roadmap,
  config,
  failures
) {
  const changedSet = new Set(changedFiles);
  const codeOrConfigChanges = changedFiles.filter((relativePath) =>
    isCodeOrConfigChange(relativePath, config)
  );
  const nightRunProfile = config.run_profile === "night";
  const docsOnlyChanges =
    changedFiles.length > 0 &&
    changedFiles.every(
      (file) =>
        isDocFile(file) ||
        isStateOrMetaFile(file) ||
        isSupportingArtifactFile(file, config)
    );

  if (codeOrConfigChanges.length > 0) {
    const requiredUpdates = nightRunProfile
      ? ["state/artifacts.json"]
      : [
          "state/tasks.json",
          "state/artifacts.json",
          "state/handoff.json"
        ];

    for (const relativePath of requiredUpdates) {
      if (!changedSet.has(relativePath)) {
        addFailure(
          failures,
          `${relativePath} not updated after progress change`
        );
      }
    }
  }

  if (nightRunProfile && changedFiles.length > 0 && docsOnlyChanges) {
    addFailure(
      failures,
      "Night run profile does not allow docs-only, state-only, or governance-only diffs"
    );
  }

  if (baseRoadmap) {
    const phaseChanged =
      baseRoadmap.current_phase !== roadmap.current_phase ||
      normalizePhaseType(baseRoadmap.phase_type) !== normalizePhaseType(roadmap.phase_type) ||
      baseRoadmap.phase_status !== roadmap.phase_status;

    if (phaseChanged) {
      const hasStateUpdate = [...STATE_UPDATE_FILES].some((relativePath) =>
        changedSet.has(relativePath)
      );

      if (!hasStateUpdate) {
        addFailure(
          failures,
          "Phase changed without updating task, artifact, handoff, or risk state"
        );
      }
    }
  }

  return {
    changedSet,
    codeOrConfigChanges,
    docsOnlyChanges
  };
}

function validateRiskContinuity(baseRisks, currentRisks, failures) {
  if (!baseRisks || !Array.isArray(baseRisks.risks) || !Array.isArray(currentRisks.risks)) {
    return;
  }

  const currentRiskMap = new Map(currentRisks.risks.map((risk) => [risk.id, risk]));

  for (const previousRisk of baseRisks.risks) {
    if (!previousRisk || !previousRisk.id) {
      continue;
    }

    const unresolved = !RESOLVED_RISK_STATUSES.has(String(previousRisk.status || "").toLowerCase());
    if (!unresolved) {
      continue;
    }

    const currentRisk = currentRiskMap.get(previousRisk.id);
    if (!currentRisk) {
      addFailure(
        failures,
        `Unresolved risk removed without resolution: ${previousRisk.id}`
      );
      continue;
    }

    const resolvedNow = RESOLVED_RISK_STATUSES.has(
      String(currentRisk.status || "").toLowerCase()
    );

    if (
      resolvedNow &&
      (!String(currentRisk.resolution || "").trim() || !currentRisk.resolved_at)
    ) {
      addFailure(
        failures,
        `Risk ${previousRisk.id} was resolved without resolution text and resolved_at`
      );
    }
  }
}

function validateDiscoveredIssues(handoff, risks, failures) {
  if (!Array.isArray(handoff.discovered_issues) || !Array.isArray(risks.risks)) {
    return;
  }

  const riskIds = new Set(risks.risks.map((risk) => risk.id));

  for (const issue of handoff.discovered_issues) {
    if (!issue || issue.requires_risk_log !== true) {
      continue;
    }

    if (!Array.isArray(issue.risk_ids) || issue.risk_ids.length === 0) {
      addFailure(
        failures,
        `Discovered issue ${issue.id || issue.summary || "<unknown>"} is missing linked risk_ids`
      );
      continue;
    }

    for (const riskId of issue.risk_ids) {
      if (!riskIds.has(riskId)) {
        addFailure(
          failures,
          `Discovered issue ${issue.id || issue.summary || "<unknown>"} references missing risk ${riskId}`
        );
      }
    }
  }
}

function evidenceRequiredForPhase(phaseType, config, codeChangesPresent) {
  const normalizedPhaseType = normalizePhaseType(phaseType);
  const allowedWithoutTests = new Set(config.allowed_phases_without_tests);
  const requiresTest =
    config.requires_test_evidence &&
    codeChangesPresent &&
    !allowedWithoutTests.has(normalizedPhaseType);

  const requirements = {
    build: false,
    test: false,
    run: false,
    deploy: false
  };

  if (normalizedPhaseType === "planning" || normalizedPhaseType === "docs") {
    return requirements;
  }

  if (codeChangesPresent || normalizedPhaseType === "build" || normalizedPhaseType === "infra" || normalizedPhaseType === "deploy") {
    requirements.build = true;
    requirements.run = true;
    requirements.test = requiresTest;
  }

  if (normalizedPhaseType === "deploy" && config.requires_deploy_evidence) {
    requirements.deploy = true;
  }

  return requirements;
}

function validatePhaseRules(
  roadmap,
  artifacts,
  changedFilesInfo,
  risks,
  handoff,
  config,
  failures
) {
  const phaseType = normalizePhaseType(roadmap.phase_type);
  const evidence = artifacts.evidence || {};
  const claims = artifacts.claims || {};
  const codeChangesPresent = changedFilesInfo.codeOrConfigChanges.length > 0;
  const required = evidenceRequiredForPhase(phaseType, config, codeChangesPresent);

  if (phaseType === "planning") {
    if (codeChangesPresent) {
      addFailure(
        failures,
        "Planning phase contains non-doc code or config changes"
      );
    }

    if (claims.implementation === "complete" || claims.deployment === "complete") {
      addFailure(
        failures,
        "Planning phase cannot claim implementation or deployment complete"
      );
    }
  }

  if (phaseType === "docs") {
    if (codeChangesPresent) {
      addFailure(
        failures,
        "Docs phase contains non-doc code or config changes"
      );
    }

    if (claims.deployment === "complete") {
      addFailure(failures, "Docs phase cannot claim deployment complete");
    }
  }

  for (const key of EVIDENCE_KEYS) {
    const entry = evidence[key];
    if (!entry) {
      continue;
    }

    if (required[key] && entry.status === "not_required") {
      addFailure(
        failures,
        `Required ${key} evidence is marked not_required`
      );
    }

    if (!required[key] && entry.status === "not_required" && !String(entry.reason || "").trim()) {
      addFailure(
        failures,
        `state/artifacts.json evidence.${key}.reason is required when ${key} evidence is not_required`
      );
    }
  }

  const missingRequiredEvidence = EVIDENCE_KEYS.filter((key) => {
    if (!required[key]) {
      return false;
    }

    const status = String((evidence[key] || {}).status || "");
    return !["passed", "failed", "not_run", "blocked"].includes(status);
  });

  if (missingRequiredEvidence.length > 0) {
    addFailure(
      failures,
      `Missing required evidence for current phase: ${missingRequiredEvidence.join(", ")}`
    );
  }

  if (changedFilesInfo.codeOrConfigChanges.length > 0 && missingRequiredEvidence.length > 0) {
    addFailure(failures, "Missing test or build evidence for changed code");
  }

  if (String(roadmap.phase_status) === "complete") {
    const incompleteEvidence = EVIDENCE_KEYS.filter((key) => {
      if (!required[key]) {
        return false;
      }
      return String((evidence[key] || {}).status || "") !== "passed";
    });

    if (incompleteEvidence.length > 0) {
      addFailure(
        failures,
        `Phase marked complete without passing required evidence: ${incompleteEvidence.join(", ")}`
      );
    }
  }

  if (config.strict_mode) {
    const blockingEvidence = EVIDENCE_KEYS.filter((key) =>
      ["failed", "blocked"].includes(String((evidence[key] || {}).status || ""))
    );

    const unresolvedRisks = Array.isArray(risks.risks)
      ? risks.risks.filter((risk) => !RESOLVED_RISK_STATUSES.has(String(risk.status || "").toLowerCase()))
      : [];
    const linkedDiscoveredIssues = Array.isArray(handoff.discovered_issues)
      ? handoff.discovered_issues.filter(
          (issue) =>
            issue &&
            issue.requires_risk_log !== false &&
            Array.isArray(issue.risk_ids) &&
            issue.risk_ids.length > 0
        )
      : [];

    if (blockingEvidence.length > 0 && unresolvedRisks.length === 0 && linkedDiscoveredIssues.length === 0) {
      addFailure(
        failures,
        "Failed or blocked evidence exists without a logged unresolved risk"
      );
    }
  }
}

function isGitIgnored(repoRoot, relativePath) {
  try {
    execFileSync("git", ["check-ignore", "-q", relativePath], {
      cwd: repoRoot,
      stdio: ["ignore", "ignore", "ignore"]
    });
    return true;
  } catch {
    return false;
  }
}

function validateGitignoreSafety(repoRoot, failures) {
  const pipelineFiles = [
    ...REQUIRED_REPO_FILES,
    "ai.config.json"
  ];

  for (const relativePath of pipelineFiles) {
    if (isGitIgnored(repoRoot, relativePath)) {
      addFailure(
        failures,
        `Pipeline file ${relativePath} is matched by .gitignore — the validator, Codex, and Claude will not see changes to this file`
      );
    }
  }
}

function validateUICompliance(repoRoot, changedFiles, failures) {
  const frontendChanges = changedFiles.filter((relativePath) =>
    isFrontendFile(relativePath)
  );

  if (frontendChanges.length === 0) {
    return;
  }

  const validationReportPath = path.join(repoRoot, "state/validation_report.md");
  if (!exists(validationReportPath)) {
    return;
  }

  const content = fs.readFileSync(validationReportPath, "utf8").toLowerCase();
  if (
    !content.includes("ui compliance") &&
    !content.includes("ui-business-software") &&
    !content.includes("ui standard")
  ) {
    addFailure(
      failures,
      "Frontend files changed without UI compliance acknowledgment in state/validation_report.md (see developer/ui-business-software.md)"
    );
  }
}

function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`FAIL:\n- ${error.message}`);
    process.exit(1);
  }

  const repoRoot = path.resolve(options.repo);
  const failures = [];

  try {
    validateGitignoreSafety(repoRoot, failures);
    validateRequiredFiles(repoRoot, failures);
    validateWorkflowFiles(repoRoot, failures);
    if (failures.length > 0) {
      throw new Error("missing-files");
    }

    const config = resolveConfig(repoRoot, options.config);
    const baseRef = resolveBaseRef(repoRoot, options.base);

    const roadmap = readJsonFile(path.join(repoRoot, "docs/roadmap/state.json"));
    const tasks = readJsonFile(path.join(repoRoot, "state/tasks.json"));
    const risks = readJsonFile(path.join(repoRoot, "state/risks.json"));
    const decisionsPath = path.join(repoRoot, "state/decisions.json");
    const decisions = exists(decisionsPath) ? readJsonFile(decisionsPath) : null;
    const artifacts = readJsonFile(path.join(repoRoot, "state/artifacts.json"));
    const handoff = readJsonFile(path.join(repoRoot, "state/handoff.json"));

    const baseRoadmap = readJsonAtGitRef(repoRoot, baseRef, "docs/roadmap/state.json");
    const baseRisks = readJsonAtGitRef(repoRoot, baseRef, "state/risks.json");

    const changedFiles = getChangedFiles(repoRoot, baseRef);
    validateLayerBoundaryViolations(repoRoot, changedFiles, config.value, failures);
    const changedFilesInfo = validateDiffAwareState(
      changedFiles,
      baseRoadmap,
      roadmap,
      config.value,
      failures
    );

    validateRoadmapState(roadmap, tasks, failures);
    validateEvidenceStructure(repoRoot, artifacts, config.value, failures);
    validateRiskAndHandoffState(risks, handoff, failures);
    if (decisions) validateDecisions(decisions, failures);
    validateRiskContinuity(baseRisks, risks, failures);
    validateDiscoveredIssues(handoff, risks, failures);
    validatePhaseRules(
      roadmap,
      artifacts,
      changedFilesInfo,
      risks,
      handoff,
      config.value,
      failures
    );
    validateUICompliance(repoRoot, changedFiles, failures);

    if (failures.length > 0) {
      console.error("FAIL:");
      for (const failure of failures) {
        console.error(`- ${failure}`);
      }
      process.exit(1);
    }

    const normalizedPhaseType = normalizePhaseType(roadmap.phase_type);
    const codeChanges = changedFilesInfo.codeOrConfigChanges.length;
    const configLabel = toRelative(repoRoot, config.path);

    console.log("PASS:");
    console.log(`- Phase ${roadmap.current_phase} (${normalizedPhaseType}) satisfies the runtime contract`);
    console.log(`- ${codeChanges} non-doc code/config file(s) require evidence in this diff`);
    console.log(`- Run profile ${config.value.run_profile}`);
    console.log(`- Config loaded from ${configLabel}`);
  } catch (error) {
    if (failures.length > 0) {
      console.error("FAIL:");
      for (const failure of failures) {
        console.error(`- ${failure}`);
      }
    } else {
      console.error(`FAIL:\n- ${error.message}`);
    }
    process.exit(1);
  }
}

main();
