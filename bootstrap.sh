#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

require_file() {
  local path="$1"
  if [[ ! -f "$path" ]]; then
    echo "Missing required file: $path" >&2
    exit 1
  fi
}

require_command() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Missing required command: $cmd" >&2
    exit 1
  fi
}

validate_json() {
  local path="$1"
  python3 -m json.tool "$path" >/dev/null
}

mkdir -p state docs/roadmap runs logs agents prompts scripts

require_command git
require_command node
require_command python3

ROOT="$ROOT" node <<'NODE'
const fs = require("fs");
const path = require("path");

const root = process.env.ROOT;
const defaults = {
  "docs/roadmap/state.json": {
    updated_at: null,
    current_phase: null,
    current_phase_branch: null,
    completed_phases: [],
    upcoming_phases: [],
    risk_remediation_phases: [],
    incidents: [],
    risks: [],
    opportunities: [],
    decisions: [],
    version: null,
    environment_status: {},
    deployment_history: [],
    promotion_history: [],
  },
  "state/env.json": {
    generated_at: null,
    env_files: {
      example: false,
      shared: false,
      local: false,
    },
    non_secret_values: {},
    node_env: null,
    ci: null,
    tool_versions: {},
  },
  "state/repo.json": {
    generated_at: null,
    repo_root: null,
    branch: null,
    commit: null,
    dirty: null,
    name: null,
    version: null,
  },
  "state/session.json": {
    branch: null,
    current_run_id: null,
    current_task: null,
    current_phase: null,
    started_at: null,
    summary: "",
    updated_at: null,
    status: "idle",
    validation: [],
  },
  "state/artifacts.json": {
    items: [],
    updated_at: null,
  },
  "state/handoff.json": {
    summary: "",
    next_steps: [],
    blockers: [],
    updated_at: null,
  },
  "state/tasks.json": {
    tasks: [],
    updated_at: null,
  },
  "state/risks.json": {
    risks: [],
    updated_at: null,
  },
  "state/decisions.json": {
    decisions: [],
    updated_at: null,
  },
};

for (const [relativePath, value] of Object.entries(defaults)) {
  const filePath = path.join(root, relativePath);
  if (fs.existsSync(filePath)) {
    continue;
  }

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
NODE

require_file docs/roadmap/state.json
require_file state/env.json
require_file state/repo.json
require_file state/session.json
require_file state/artifacts.json
require_file state/handoff.json
require_file state/tasks.json
require_file state/risks.json
require_file state/decisions.json

validate_json docs/roadmap/state.json
validate_json state/env.json
validate_json state/repo.json
validate_json state/session.json
validate_json state/artifacts.json
validate_json state/handoff.json
validate_json state/tasks.json
validate_json state/risks.json
validate_json state/decisions.json

if [[ ! -d node_modules/.pnpm ]] || [[ ! -x apps/desktop/node_modules/.bin/vite ]] || [[ ! -x node_modules/.bin/vitest ]]; then
  echo "Installing workspace dependencies with the pinned pnpm toolchain..."
  node ./scripts/pnpmw.mjs install --frozen-lockfile
fi

ROOT="$ROOT" node <<'NODE'
const fs = require("fs");
const path = require("path");
const { execSync, spawnSync } = require("child_process");

const root = process.env.ROOT;
const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, "utf8"));
const writeJson = (filePath, value) => {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
};
const commandOutput = (command) => {
  try {
    return execSync(command, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch {
    return "";
  }
};

const roadmapState = readJson(path.join(root, "docs/roadmap/state.json"));
const packagePath = path.join(root, "package.json");
const packageJson = fs.existsSync(packagePath)
  ? JSON.parse(fs.readFileSync(packagePath, "utf8"))
  : {};

const repoRoot = commandOutput("git rev-parse --show-toplevel");
const branch = commandOutput("git rev-parse --abbrev-ref HEAD");
const commit = commandOutput("git rev-parse HEAD");
const dirty =
  spawnSync("bash", ["-lc", "git diff --quiet && git diff --cached --quiet"], {
    cwd: root,
    stdio: "ignore"
  }).status !== 0;

const envState = {
  generated_at: new Date().toISOString(),
  env_files: {
    example: fs.existsSync(path.join(root, ".env.example")),
    shared: fs.existsSync(path.join(root, ".env.shared")),
    local: fs.existsSync(path.join(root, ".env"))
  },
  non_secret_values: {},
  node_env: process.env.NODE_ENV || null,
  ci: process.env.CI || null,
  tool_versions: {
    node: commandOutput("node -v"),
    npm: commandOutput("npm -v"),
    python3: commandOutput("python3 --version"),
    git: commandOutput("git --version")
  }
};

const repoState = {
  generated_at: envState.generated_at,
  repo_root: repoRoot || root,
  branch,
  commit,
  dirty,
  name: packageJson.name || path.basename(root),
  version: packageJson.version || null
};

writeJson(path.join(root, "state/env.json"), envState);
writeJson(path.join(root, "state/repo.json"), repoState);

process.stdout.write(
  JSON.stringify(
    {
      status: "READY",
      repo: repoState,
      roadmap: {
        current_phase: roadmapState.current_phase ?? null,
        updated_at: roadmapState.updated_at ?? null
      },
      paths: {
        state_dir: path.join(root, "state"),
        scripts_dir: path.join(root, "scripts"),
        artifacts_file: path.join(root, "state/artifacts.json"),
        handoff_file: path.join(root, "state/handoff.json"),
        roadmap_dir: path.join(root, "docs/roadmap"),
        runs_dir: path.join(root, "runs"),
        logs_dir: path.join(root, "logs")
      }
    },
    null,
    2
  ) + "\n"
);
NODE
