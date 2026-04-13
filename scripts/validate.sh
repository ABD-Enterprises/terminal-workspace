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
