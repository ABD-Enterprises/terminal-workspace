#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "[validate] effort guard"
bash ./scripts/effort-guard.sh

if [[ ! -x "./node_modules/.bin/eslint" || ! -x "./node_modules/.bin/vitest" || ! -x "./node_modules/.bin/playwright" ]]; then
  echo "[validate] dependencies are missing; run npm run setup before validation." >&2
  exit 1
fi

echo "[validate] lint"
./node_modules/.bin/eslint .

echo "[validate] unit and integration tests"
./node_modules/.bin/vitest run --config vitest.config.ts

echo "[validate] desktop build"
node ./scripts/pnpmw.mjs --filter desktop build

# #177: build + test the native (src-tauri) crate as part of the default local
# gate so a broken native build can no longer pass `npm run validate` green.
# #157 added the rustfmt and clippy gates to the same branch.
# `cargo test` compiles the crate (icons are committed and the desktop build
# above produced tauri.conf's frontendDist, so generate_context! resolves) and
# runs the tests; a compile error or failing test fails validation via set -e.
# The crate only ships on macOS, so this is Darwin-gated; on Darwin without a
# Rust toolchain it advisory-skips with a loud warning rather than blocking a
# contributor who is only touching the web app.
if [[ "$(uname -s)" == "Darwin" ]]; then
  if command -v cargo >/dev/null 2>&1; then
    # #157: format and lint before the build, so a style failure is reported in
    # seconds rather than after a full compile. A missing clippy/rustfmt here is
    # an INCOMPLETE toolchain and fails loudly — unlike a missing cargo, which
    # advisory-skips below for contributors only touching the web app.
    echo "[validate] rust formatting"
    npm run native:fmt:check
    echo "[validate] rust lint"
    npm run native:clippy
    echo "[validate] rust build + tests"
    cargo test --manifest-path src-tauri/Cargo.toml
  else
    echo "[validate] WARNING: cargo not found on PATH — the native src-tauri crate is NOT being validated locally." >&2
    echo "[validate] WARNING: install the Rust toolchain (https://rustup.rs) so native breakage cannot ship green." >&2
  fi
else
  echo "[validate] rust build + tests skipped (macOS only — the native crate ships on macOS)"
fi

if [[ "${TERMSNIP_RUN_NATIVE_TRUST:-0}" == "1" && "$(uname -s)" == "Darwin" ]]; then
  echo "[validate] native trust tooling"
  bash ./scripts/native-trust-tooling-test.sh
elif [[ "$(uname -s)" == "Darwin" ]]; then
  echo "[validate] native trust tooling skipped (set TERMSNIP_RUN_NATIVE_TRUST=1 to include)"
else
  echo "[validate] native trust tooling skipped (macOS only)"
fi

# #275: the localhost sshd fixture, which CI runs and local validation did not.
#
# It is #[ignore]d because it needs a real sshd and an unsandboxed environment,
# so it cannot be on by default. But it is the ONLY test that exercises the real
# transport, which means the deadlock-prone paths were the least covered locally.
#
# That is not hypothetical. #193 changed the PTY reader threads to stop on a
# failed send — reviewed and merged as an obvious thread-leak fix. It was wrong:
# with_native_ssh_control_session leaves its ControlMaster child running and
# drops the receiver, so a reader that stops lets the PTY buffer fill and blocks
# ssh forever. The full local suite was green 30 runs running; this fixture
# reproduces it in 10 seconds. CI found it instead, as a 30-minute timeout
# reported as "cancelled" — which reads as infra, so a rerun was spent
# confirming it was not.
#
# Run this before pushing anything that touches the reader threads, the session
# loops, or native_transport's capture loops. The failure mode there is a hang,
# not a failing assertion, so a green unit suite is not evidence.
#
# #292 added ignored regressions for the fixture's own cleanup path. They kill
# a helper process to reproduce leaked sshds, then prove a later fixture startup
# reaps the orphan without disturbing a live fixture. The shared name prefix
# keeps those leak regressions in this same real-sshd gate.
if [[ "${TERMSNIP_RUN_SSH_FIXTURE:-0}" == "1" && "$(uname -s)" == "Darwin" ]]; then
  if command -v cargo >/dev/null 2>&1; then
    echo "[validate] localhost sshd transport and reaper fixtures"
    cargo test --manifest-path src-tauri/Cargo.toml \
      localhost_ssh_transport_fixture -- --include-ignored
  else
    echo "[validate] localhost sshd fixture skipped (cargo not found on PATH)" >&2
  fi
elif [[ "$(uname -s)" == "Darwin" ]]; then
  echo "[validate] localhost sshd transport fixture skipped (set TERMSNIP_RUN_SSH_FIXTURE=1 to include — required for changes to the PTY readers, session loops, or native_transport capture loops)"
else
  echo "[validate] localhost sshd transport fixture skipped (macOS only — the native crate ships on macOS)"
fi

# #226: Rust advisory scan. src-tauri/audit.toml described an "enforcing
# invocation" that nothing ran, so its "verified clean" claim rotted — by the
# time this gate was added the tree had four advisories, two of them 7.5 high.
#
# Opt-in locally (cargo-audit is not part of the Rust toolchain and fetches an
# advisory database), REQUIRED in CI. It matters here because ssh2 is built with
# vendored-openssl: OpenSSL is statically linked, so an advisory needs a rebuild
# rather than an OS patch.
if [[ "${TERMSNIP_RUN_RUST_AUDIT:-0}" == "1" ]]; then
  echo "[validate] rust advisory audit"
  bash ./scripts/native-audit.sh
else
  echo "[validate] rust advisory audit skipped (set TERMSNIP_RUN_RUST_AUDIT=1 to include — required for dependency changes; CI runs it on every PR)"
fi

# #185: the real backend.mjs. Everything else in this gate proves UI wiring
# against mocks — playwright boots vite in demo mode and the integration suite
# exercises resetDemoBackend() or extracted helpers, none of which binds a port.
# So a broken SSH/SFTP transport, auth gate, or session lifecycle could pass the
# entire local gate while the shipped app could not open a session.
#
# Opt-in locally because it needs a real sshd, but REQUIRED in CI (the macOS job)
# — leaving it local-only would preserve exactly that failure mode.
if [[ "${TERMSNIP_RUN_BACKEND_FIXTURE:-0}" == "1" && "$(uname -s)" == "Darwin" ]]; then
  echo "[validate] real backend transport fixture"
  bash ./scripts/backend-transport-test.sh
elif [[ "$(uname -s)" == "Darwin" ]]; then
  echo "[validate] real backend transport fixture skipped (set TERMSNIP_RUN_BACKEND_FIXTURE=1 to include — required for changes to backend.mjs, its auth gate, or the session lifecycle)"
else
  echo "[validate] real backend transport fixture skipped (macOS only — needs a local sshd)"
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

if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  SEMGREP_TARGETS=()

  if [[ -n "$SEMGREP_BASE_REF" ]]; then
    while IFS= read -r target; do
      [[ -n "$target" ]] || continue
      [[ -f "$target" ]] || continue
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
    # #149: the image is pinned by tag AND digest. It was `semgrep/semgrep`,
    # i.e. :latest, so a semgrep release could change this gate's behaviour with
    # no commit here. The digest was verified against the live registry
    # (`docker buildx imagetools inspect semgrep/semgrep:1.172.0`) rather than
    # copied from a doc page.
    #
    # `--config=auto` is knowingly still remote, and is the other half of the
    # nondeterminism: the ruleset can change under a PR. Pinning it means
    # vendoring the ruleset, which needs a license review — tracked separately
    # rather than done hastily here.
    if docker run --rm -v "${SEMGREP_SCAN_ROOT}":/src -w /src -e SEMGREP_APP_TOKEN \
      semgrep/semgrep:1.172.0@sha256:65dcd4408adda7c183a6b4550cb1e9b19f7f627a6fbb7e0559bd466bedc44d7b \
      semgrep scan --config=auto --error "${SEMGREP_TARGETS[@]}" >"$SEMGREP_OUTPUT_FILE" 2>&1; then
      printf 'PASS: semgrep completed successfully
' >"$SEMGREP_STATUS_FILE"
    else
      cat "$SEMGREP_OUTPUT_FILE" >&2
      exit 1
    fi
  fi
else
  # #149: this used to record NOT RUN and continue, so local validation passed
  # while quietly skipping the scan that CI always runs — the worst kind of
  # green, because it looks identical to a real one.
  #
  # Fail closed, matching the posture for clippy/rustfmt rather than the one for
  # cargo: a missing cargo advisory-skips because a web-only contributor should
  # not be blocked by a native toolchain, but semgrep covers the web and native
  # code alike, so its absence is an incomplete toolchain rather than an absent
  # optional one.
  printf 'FAIL: Docker is unavailable, so semgrep did not run
' >"$SEMGREP_STATUS_FILE"
  echo "[validate] Docker is unavailable, so semgrep could not run." >&2
  echo "[validate] Start Docker and re-run: this gate gives CI-equivalent coverage and is not optional." >&2
  exit 1
fi
