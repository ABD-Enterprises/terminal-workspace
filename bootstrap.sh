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

require_file docs/roadmap/state.json
require_file state/session.json
require_file state/artifacts.json
require_file state/handoff.json
require_file state/tasks.json
require_file state/risks.json
require_file state/decisions.json

validate_json docs/roadmap/state.json
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
