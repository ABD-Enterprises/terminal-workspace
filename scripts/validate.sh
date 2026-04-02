#!/usr/bin/env bash
set -euo pipefail

ROOT="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
ROOT="$(cd "$ROOT" && pwd)"
cd "$ROOT"

echo "[validate] lint"
node ./scripts/pnpmw.mjs exec eslint .

echo "[validate] unit and integration tests"
node ./scripts/pnpmw.mjs exec vitest run --config vitest.config.ts

echo "[validate] desktop build"
node ./scripts/pnpmw.mjs --filter desktop build

if [[ "${TERMSNIP_RUN_E2E:-0}" == "1" ]]; then
  echo "[validate] browser e2e"
  node ./scripts/pnpmw.mjs exec playwright test --config playwright.config.ts
else
  echo "[validate] browser e2e skipped (set TERMSNIP_RUN_E2E=1 to include)"
fi
