#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

fail() {
  printf '[effort-guard] %s\n' "$*" >&2
  exit 1
}

note() {
  printf '[effort-guard] %s\n' "$*"
}

if command -v ai-pipeline >/dev/null 2>&1 && [[ -f ".ai/config.json" ]]; then
  stderr_file="$(mktemp)"
  if ! ai-pipeline current --json >/dev/null 2>"$stderr_file"; then
    if grep -q "Invalid config" "$stderr_file"; then
      cat "$stderr_file" >&2
      rm -f "$stderr_file"
      fail "local .ai/config.json is incompatible with this ai-pipeline version; refresh it before starting work."
    fi
    note "no current ticket detected; run ai-pipeline next or ai-pipeline plan before new implementation work."
  fi
  rm -f "$stderr_file"
elif [[ -f ".ai/config.json" ]]; then
  note "ai-pipeline is not installed; skipping local adapter check."
else
  note "no local .ai/config.json; skipping local adapter check."
fi

mapfile -t pull_request_workflows < <(
  grep -RslE '^[[:space:]]*pull_request:' .github/workflows 2>/dev/null || true
)

validation_workflows=()
for workflow in "${pull_request_workflows[@]}"; do
  if grep -Eq 'npm run (validate|test)|npm --prefix ./apps/desktop run build|playwright test' "$workflow"; then
    validation_workflows+=("$workflow")
  fi
done

if [[ ${#validation_workflows[@]} -gt 1 ]]; then
  printf '[effort-guard] overlapping pull_request validation workflows:\n' >&2
  printf '  %s\n' "${validation_workflows[@]}" >&2
  fail "keep one CI validation entrypoint to avoid duplicate GitHub Actions spend."
fi

tracked_browser_artifacts="$(git ls-files -- artifacts/e2e playwright-report test-results)"
if [[ -n "$tracked_browser_artifacts" ]]; then
  printf '[effort-guard] tracked generated browser artifacts:\n' >&2
  printf '%s\n' "$tracked_browser_artifacts" | sed 's/^/  /' >&2
  fail "generated browser artifacts are tracked; keep validation outputs local or uploaded from CI only."
fi

note "ok"
