#!/usr/bin/env bash
set -euo pipefail

ROOT="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
ROOT="$(cd "$ROOT" && pwd)"
cd "$ROOT"

echo "[validate] lint"
./node_modules/.bin/eslint .

echo "[validate] unit and integration tests"
./node_modules/.bin/vitest run --config vitest.config.ts

echo "[validate] desktop build"
npm --prefix ./apps/desktop run build

if [[ "$(uname -s)" == "Darwin" ]]; then
  echo "[validate] native trust tooling"
  bash ./scripts/native-trust-tooling-test.sh
else
  echo "[validate] native trust tooling skipped (macOS only)"
fi

if [[ "${TERMSNIP_RUN_E2E:-0}" == "1" ]]; then
  echo "[validate] browser e2e"
  ./node_modules/.bin/playwright test --config playwright.config.ts
else
  echo "[validate] browser e2e skipped (set TERMSNIP_RUN_E2E=1 to include)"
fi

echo "[validate] guardrails"
VALIDATOR_ARGS=(--repo . --config ai.config.json)

if [[ -n "${AI_VALIDATOR_BASE_REF:-}" ]]; then
  VALIDATOR_ARGS+=(--base "${AI_VALIDATOR_BASE_REF}")
elif [[ -n "${GITHUB_BASE_REF:-}" ]]; then
  VALIDATOR_ARGS+=(--base "origin/${GITHUB_BASE_REF}")
fi

node ./tools/validators/enforce-runtime-guardrails.mjs "${VALIDATOR_ARGS[@]}"

BASE_REF="${AI_VALIDATOR_BASE_REF:-${1:-}}"
VALIDATION_ARTIFACT_DIR="artifacts/validation"
SEMGREP_STATUS_FILE="${VALIDATION_ARTIFACT_DIR}/semgrep-status.txt"
SEMGREP_OUTPUT_FILE="${VALIDATION_ARTIFACT_DIR}/semgrep-output.txt"

mkdir -p "$VALIDATION_ARTIFACT_DIR"
rm -f "$SEMGREP_STATUS_FILE" "$SEMGREP_OUTPUT_FILE"

if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  SEMGREP_ENVS=(-e SEMGREP_APP_TOKEN)
  if [[ -n "$BASE_REF" ]]; then
    SEMGREP_ENVS+=(-e "SEMGREP_BASELINE_REF=$BASE_REF")
  fi

  if docker run --rm -v "${ROOT}":/src -w /src "${SEMGREP_ENVS[@]}" semgrep/semgrep semgrep ci --config=auto >"$SEMGREP_OUTPUT_FILE" 2>&1; then
    printf 'PASS: semgrep completed successfully
' >"$SEMGREP_STATUS_FILE"
  else
    cat "$SEMGREP_OUTPUT_FILE" >&2
    exit 1
  fi
else
  printf 'NOT RUN: Docker is unavailable in this environment
' >"$SEMGREP_STATUS_FILE"
fi
