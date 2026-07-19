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

# #189: the legacy `ai-pipeline` adapter check was removed. The repo now runs on
# ORC, and a drifted `ai-pipeline` install could hard-fail on "Invalid config",
# aborting `npm run validate` before any real check ran. This guard keeps only
# the artifact-hygiene checks below.

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

tracked_browser_artifacts="$(git ls-files -- artifacts/e2e artifacts/validation playwright-report test-results)"
if [[ -n "$tracked_browser_artifacts" ]]; then
  printf '[effort-guard] tracked generated validation/browser artifacts:\n' >&2
  printf '%s\n' "$tracked_browser_artifacts" | sed 's/^/  /' >&2
  fail "generated validation/browser artifacts are tracked; keep validation outputs local or uploaded from CI only."
fi

note "ok"
