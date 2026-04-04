#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const cp = require("node:child_process");

const root = process.cwd();
const args = process.argv.slice(2);
const baseIndex = args.indexOf("--base");
const explicitBaseRef = baseIndex >= 0 ? args[baseIndex + 1] : undefined;
const failures = [];
const notices = [];

function run(command, options = {}) {
  try {
    return cp.execSync(command, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      ...options,
    }).trim();
  } catch (error) {
    if (options.allowFailure) {
      return "";
    }

    throw error;
  }
}

function fileExists(relativePath) {
  return fs.existsSync(path.join(root, relativePath));
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
}

function fail(message) {
  failures.push(message);
}

function info(message) {
  notices.push(message);
}

function normalizeResult(result) {
  return String(result ?? "").trim().toLowerCase().replace(/\s+/g, "_");
}

function getBaseRef() {
  if (explicitBaseRef) {
    return explicitBaseRef;
  }

  if (process.env.GITHUB_BASE_REF) {
    return `origin/${process.env.GITHUB_BASE_REF}`;
  }

  return "";
}

function parseJsonFromGit(ref, relativePath) {
  if (!ref) {
    return null;
  }

  try {
    const content = run(`git show ${ref}:${relativePath}`, { allowFailure: true });
    return content ? JSON.parse(content) : null;
  } catch {
    return null;
  }
}

function getChangedFiles(baseRef) {
  const changed = new Set();
  const commands = [];

  if (baseRef) {
    commands.push(`git diff --name-only ${baseRef}...HEAD`);
  }

  commands.push("git diff --name-only HEAD~1...HEAD");
  commands.push("git diff --name-only");
  commands.push("git diff --name-only --cached");
  commands.push("git ls-files --others --exclude-standard");

  for (const command of commands) {
    const output = run(command, { allowFailure: true });
    output
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .forEach((file) => changed.add(file));
  }

  return Array.from(changed).sort();
}

function isDocumentationPath(file) {
  return (
    file.startsWith("docs/") ||
    file === "README.md" ||
    file.startsWith("agents/") ||
    file.startsWith("prompts/")
  );
}

function isStatePath(file) {
  return file.startsWith("state/") || file === "docs/roadmap/state.json";
}

function isExecutionPath(file) {
  return (
    !isDocumentationPath(file) &&
    !isStatePath(file)
  );
}

const requiredFiles = [
  "docs/roadmap/roadmap.md",
  "docs/roadmap/state.json",
  "state/session.json",
  "state/tasks.json",
  "state/risks.json",
  "state/decisions.json",
  "agents/codex.md",
  "agents/claude.md",
  "agents/reviewer.md",
  "prompts/mega.md",
  "prompts/lean.md",
  "prompts/deploy.md",
  "tools/validators/enforce-runtime-guardrails.js",
];

for (const requiredFile of requiredFiles) {
  if (!fileExists(requiredFile)) {
    fail(`Missing required contract file: ${requiredFile}`);
  }
}

if (failures.length) {
  console.error("FAIL");
  failures.forEach((message) => console.error(`- ${message}`));
  process.exit(1);
}

const roadmap = readJson("docs/roadmap/state.json");
const session = readJson("state/session.json");
const tasksState = readJson("state/tasks.json");
const risksState = readJson("state/risks.json");
const decisionsState = readJson("state/decisions.json");

const branch = run("git rev-parse --abbrev-ref HEAD", { allowFailure: true }) || "(unknown)";
const baseRef = getBaseRef();
const changedFiles = getChangedFiles(baseRef);
const executionFiles = changedFiles.filter(isExecutionPath);
const stateFiles = changedFiles.filter(isStatePath);

if (!roadmap.current_phase) {
  fail("docs/roadmap/state.json must define current_phase.");
}

if (!roadmap.last_updated && !roadmap.updated_at) {
  fail("docs/roadmap/state.json must define last_updated or updated_at.");
}

if (!Array.isArray(roadmap.tasks)) {
  fail("docs/roadmap/state.json must define a top-level tasks array.");
}

if (!Array.isArray(roadmap.risks)) {
  fail("docs/roadmap/state.json must define a top-level risks array.");
}

if (!Array.isArray(session.validation)) {
  fail("state/session.json must define a validation array.");
}

if (!Array.isArray(tasksState.tasks)) {
  fail("state/tasks.json must define a tasks array.");
}

if (!Array.isArray(risksState.risks)) {
  fail("state/risks.json must define a risks array.");
}

if (!Array.isArray(decisionsState.decisions)) {
  fail("state/decisions.json must define a decisions array.");
}

if (roadmap.current_phase_branch && roadmap.current_phase_branch !== branch) {
  fail(
    `Current phase branch mismatch: roadmap expects ${roadmap.current_phase_branch}, git reports ${branch}.`
  );
}

const roadmapRiskIds = new Set((roadmap.risks || []).map((risk) => risk.id));
const stateRiskIds = new Set((risksState.risks || []).map((risk) => risk.id));

for (const riskId of roadmapRiskIds) {
  if (!stateRiskIds.has(riskId)) {
    fail(`Risk ${riskId} exists in roadmap state but not in state/risks.json.`);
  }
}

for (const riskId of stateRiskIds) {
  if (!roadmapRiskIds.has(riskId)) {
    fail(`Risk ${riskId} exists in state/risks.json but not in docs/roadmap/state.json.`);
  }
}

const roadmapTaskIds = new Set((roadmap.tasks || []).map((task) => task.id));
const stateTaskIds = new Set((tasksState.tasks || []).map((task) => task.id));

for (const taskId of stateTaskIds) {
  if (!roadmapTaskIds.has(taskId)) {
    fail(`Task ${taskId} exists in state/tasks.json but not in docs/roadmap/state.json.`);
  }
}

const previousRoadmap = parseJsonFromGit(baseRef, "docs/roadmap/state.json");

if (previousRoadmap?.risks) {
  for (const previousRisk of previousRoadmap.risks) {
    if (previousRisk.status !== "open") {
      continue;
    }

    const currentRisk = roadmap.risks.find((risk) => risk.id === previousRisk.id);
    if (!currentRisk) {
      fail(`Open risk ${previousRisk.id} was removed. Preserve it or resolve it explicitly.`);
      continue;
    }

    if (currentRisk.status === "resolved" && !currentRisk.resolved_at) {
      fail(`Resolved risk ${currentRisk.id} must include resolved_at.`);
    }
  }
}

const validationEntries = session.validation || [];
const passLikeResults = new Set(["pass", "passed"]);
const explicitResults = new Set(["pass", "passed", "fail", "failed", "not_run", "blocked"]);
const normalizedValidationResults = validationEntries.map((entry) => normalizeResult(entry.result));

for (const [index, entry] of validationEntries.entries()) {
  if (!entry.command || !entry.result) {
    fail(`Validation entry ${index + 1} in state/session.json must include command and result.`);
  }

  if (!explicitResults.has(normalizeResult(entry.result))) {
    fail(
      `Validation entry ${index + 1} uses unsupported result "${entry.result}". Use PASS/FAIL/NOT RUN/BLOCKED.`
    );
  }
}

const phaseName = String(roadmap.current_phase || "").toLowerCase();
const docsPhase = /docs|documentation/.test(phaseName);
const deployPhase = /deploy|deployment/.test(phaseName);

if (executionFiles.length > 0 && stateFiles.length === 0) {
  fail(
    "Execution changes were detected without roadmap/state updates. Update docs/roadmap/state.json and /state/* when work progresses."
  );
}

if (executionFiles.length > 0 && validationEntries.length === 0) {
  fail("Execution changes require recorded evidence in state/session.json.");
}

if (executionFiles.length > 0 && !normalizedValidationResults.some((result) => passLikeResults.has(result) || result === "not_run" || result === "blocked")) {
  fail("Execution changes require at least one PASS, NOT RUN, or BLOCKED evidence entry.");
}

if ((roadmap.current_phase_status === "completed" || roadmap.current_phase_status === "validated") && !docsPhase) {
  if (!normalizedValidationResults.some((result) => passLikeResults.has(result))) {
    fail(`Phase ${roadmap.current_phase} is marked ${roadmap.current_phase_status} without passing evidence.`);
  }
}

if (deployPhase) {
  const deploymentStatus = roadmap.environment_status?.deployment;
  const deploymentHistory = Array.isArray(roadmap.deployment_history) ? roadmap.deployment_history : [];
  if (deploymentStatus === "not_deployed" || deploymentHistory.length === 0) {
    fail("Deploy phases require deployment evidence in roadmap state.");
  }
}

const openRisks = roadmap.risks.filter((risk) => risk.status === "open");
if (normalizedValidationResults.some((result) => result === "failed" || result === "blocked") && openRisks.length === 0) {
  fail("Blocked or failed evidence was recorded without any open risk in roadmap state.");
}

info(`branch=${branch}`);
info(`current_phase=${roadmap.current_phase}`);
info(`changed_files=${changedFiles.length}`);
info(`validation_entries=${validationEntries.length}`);
console.log("PASS");
notices.forEach((message) => console.log(`- ${message}`));
