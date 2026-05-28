#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "[validate] effort guard"
bash ./scripts/effort-guard.sh

echo "[validate] lint"
./node_modules/.bin/eslint .

echo "[validate] unit and integration tests"
./node_modules/.bin/vitest run --config vitest.config.ts

echo "[validate] desktop build"
npm --prefix ./apps/desktop run build

if [[ "${TERMSNIP_RUN_NATIVE_TRUST:-0}" == "1" && "$(uname -s)" == "Darwin" ]]; then
  echo "[validate] native trust tooling"
  bash ./scripts/native-trust-tooling-test.sh
elif [[ "$(uname -s)" == "Darwin" ]]; then
  echo "[validate] native trust tooling skipped (set TERMSNIP_RUN_NATIVE_TRUST=1 to include)"
else
  echo "[validate] native trust tooling skipped (macOS only)"
fi

if [[ "${TERMSNIP_RUN_E2E:-0}" == "1" ]]; then
  echo "[validate] browser e2e"
  ./node_modules/.bin/playwright test --config playwright.config.ts
else
  echo "[validate] browser e2e skipped (set TERMSNIP_RUN_E2E=1 to include)"
fi

VALIDATION_ARTIFACT_DIR="artifacts/validation"
SEMGREP_STATUS_FILE="${VALIDATION_ARTIFACT_DIR}/semgrep-status.txt"
SEMGREP_OUTPUT_FILE="${VALIDATION_ARTIFACT_DIR}/semgrep-output.txt"
mkdir -p "$VALIDATION_ARTIFACT_DIR"
rm -f "$SEMGREP_STATUS_FILE" "$SEMGREP_OUTPUT_FILE"
SEMGREP_SCAN_ROOT="${ROOT:-$(pwd)}"
SEMGREP_BASE_REF="${AI_VALIDATOR_BASE_REF:-}"

if [[ -z "$SEMGREP_BASE_REF" && -n "${GITHUB_BASE_REF:-}" ]]; then
  SEMGREP_BASE_REF="origin/${GITHUB_BASE_REF}"
fi

if [[ -z "$SEMGREP_BASE_REF" && -n "${BASE_REF:-}" && "$BASE_REF" != "HEAD~1" ]]; then
  SEMGREP_BASE_REF="$BASE_REF"
fi

if [[ -z "$SEMGREP_BASE_REF" ]]; then
  DEFAULT_REMOTE_HEAD="$(git symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null || true)"
  DEFAULT_REMOTE_HEAD="${DEFAULT_REMOTE_HEAD#origin/}"
  if [[ -n "$DEFAULT_REMOTE_HEAD" ]] && git show-ref --verify --quiet "refs/remotes/origin/${DEFAULT_REMOTE_HEAD}"; then
    SEMGREP_BASE_REF="origin/${DEFAULT_REMOTE_HEAD}"
  elif git show-ref --verify --quiet refs/remotes/origin/main; then
    SEMGREP_BASE_REF="origin/main"
  fi
fi

should_skip_semgrep_target() {
  local target="$1"

  case "$target" in
    tools/validators/*)
      return 0
      ;;
  esac

  return 1
}

if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  SEMGREP_TARGETS=()

  if [[ -n "$SEMGREP_BASE_REF" ]]; then
    while IFS= read -r target; do
      [[ -n "$target" ]] || continue
      [[ -f "$target" ]] || continue
      should_skip_semgrep_target "$target" && continue
      SEMGREP_TARGETS+=("$target")
    done < <(
      {
        git diff --name-only "${SEMGREP_BASE_REF}...HEAD" --
        git diff --name-only --cached --
        git diff --name-only --
      } | sort -u
    )
  fi

  if [[ ${#SEMGREP_TARGETS[@]} -eq 0 ]]; then
    if [[ -n "$SEMGREP_BASE_REF" ]]; then
      printf 'PASS: no scannable changed files for semgrep
' >"$SEMGREP_STATUS_FILE"
    else
      SEMGREP_TARGETS=(.)
    fi
  fi

  if [[ ${#SEMGREP_TARGETS[@]} -gt 0 ]]; then
    if docker run --rm -v "${SEMGREP_SCAN_ROOT}":/src -w /src -e SEMGREP_APP_TOKEN semgrep/semgrep semgrep scan --config=auto --error "${SEMGREP_TARGETS[@]}" >"$SEMGREP_OUTPUT_FILE" 2>&1; then
      printf 'PASS: semgrep completed successfully
' >"$SEMGREP_STATUS_FILE"
    else
      cat "$SEMGREP_OUTPUT_FILE" >&2
      exit 1
    fi
  fi
else
  printf 'NOT RUN: Docker is unavailable in this environment
' >"$SEMGREP_STATUS_FILE"
fi
