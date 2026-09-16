#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "[validate] effort guard"
bash ./scripts/effort-guard.sh

# #379: the five version sources must agree; the bundle and latest.json follow
# tauri.conf.json and a stale npm/Cargo copy would ship mislabelled metadata.
echo "[validate] version consistency"
node ./scripts/check-version-consistency.mjs

# #319: no secret value on any process argv, in any of the three languages that
# build command lines here. Runs before the dependency check on purpose: it
# needs only node, so a fresh clone gets the finding first.
echo "[validate] secret-argv check"
node ./scripts/secret-argv-check.mjs

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
if [[ "${TERMSNIP_RUN_SSH_FIXTURE:-0}" == "1" && "$(uname -s)" != "Windows_NT" ]]; then
  if command -v cargo >/dev/null 2>&1; then
    echo "[validate] localhost sshd transport and reaper fixtures"
    # Every #[ignore]d test in the fixtures module, by module path rather than by name,
    # so a renamed or added fixture cannot silently drop out of CI (#363 review).
    cargo test --manifest-path src-tauri/Cargo.toml native_transport_fixtures:: -- --ignored --test-threads=1
  else
    echo "[validate] localhost sshd fixture skipped (cargo not found on PATH)" >&2
  fi
elif [[ "$(uname -s)" != "Windows_NT" ]]; then
  echo "[validate] localhost sshd transport fixture skipped (set TERMSNIP_RUN_SSH_FIXTURE=1 to include — required for changes to the PTY readers, session loops, or native_transport capture loops)"
else
  echo "[validate] localhost sshd transport fixture skipped (Unix only — needs a local sshd)"
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
  SEMGREP_RULESET_CHANGED=0

  if [[ -n "$SEMGREP_BASE_REF" ]]; then
    while IFS= read -r target; do
      [[ -n "$target" ]] || continue
      # #284: any change to the pin — including a deletion, so this runs
      # before the file-exists filter — forces a whole-repository scan below.
      # The submodule is patterns and deliberately-vulnerable fixtures, not
      # code to scan, and explicit targets would bypass .semgrepignore.
      if [[ "$target" == .semgrep/* || "$target" == .gitmodules ]]; then
        SEMGREP_RULESET_CHANGED=1
        continue
      fi
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

  if [[ "$SEMGREP_RULESET_CHANGED" == 1 ]]; then
    # #284: a change to the pin (submodule pointer, manifest) must not be the
    # one change the gate never exercises — that is exactly how a broken or
    # malicious pin would slip in. Scan the whole repository, whatever else
    # changed, so the PR shows what the new pin catches.
    echo "[validate] semgrep ruleset changed; scanning the whole repository" >&2
    SEMGREP_TARGETS=(.)
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
    # #284: the ruleset is pinned too. .semgrep/rules is a git submodule of
    # semgrep/semgrep-rules held at one commit (a reference, not a copy — the
    # rules are Semgrep Rules License v1.0, which forbids redistribution, so
    # they are never committed here), and .semgrep/rules.tsv names exactly the
    # rule files that made up the registry's c/auto response at the snapshot.
    # See .semgrep/README.md for owner, cadence and the refresh procedure.
    #
    # Nothing here falls back to the registry: a missing file in the manifest
    # is a hard failure, and --metrics=off makes the registry auto-config impossible
    # (semgrep refuses to build an auto config with metrics off).
    semgrep_rules_dir="${SEMGREP_SCAN_ROOT}/.semgrep/rules"
    if [[ ! -f "${semgrep_rules_dir}/LICENSE" ]]; then
      # CI checks out without submodules; a fresh clone has an empty directory.
      # This fetches one pinned commit from git, never rules from the registry.
      git -C "${SEMGREP_SCAN_ROOT}" submodule update --init --depth 1 -- .semgrep/rules >&2 || {
        printf 'FAIL: semgrep ruleset submodule (.semgrep/rules) could not be initialised\n' >"$SEMGREP_STATUS_FILE"
        echo "[validate] .semgrep/rules is empty and 'git submodule update --init' failed; see .semgrep/README.md." >&2
        exit 1
      }
    fi
    semgrep_submodule_status="$(git -C "${SEMGREP_SCAN_ROOT}" submodule status -- .semgrep/rules 2>/dev/null || true)"
    if [[ "$semgrep_submodule_status" == +* || "$semgrep_submodule_status" == -* ]]; then
      printf 'FAIL: .semgrep/rules is not at the pinned commit\n' >"$SEMGREP_STATUS_FILE"
      echo "[validate] .semgrep/rules checkout differs from the pinned commit (${semgrep_submodule_status}); run 'git submodule update -- .semgrep/rules'." >&2
      exit 1
    fi
    # A pin nobody bumps is silent decay. The manifest header records the
    # snapshot date; warn past the 90-day cadence, fail past 120.
    semgrep_snapshot="$(sed -n 's/^# .*snapshot: \([0-9-]*\).*/\1/p' "${SEMGREP_SCAN_ROOT}/.semgrep/rules.tsv" | head -n1)"
    if [[ -z "$semgrep_snapshot" ]]; then
      printf 'FAIL: .semgrep/rules.tsv has no snapshot date\n' >"$SEMGREP_STATUS_FILE"
      echo "[validate] .semgrep/rules.tsv header is missing its 'snapshot: YYYY-MM-DD' field." >&2
      exit 1
    fi
    semgrep_manifest_commit="$(sed -n 's/^# .*submodule: \([0-9a-f]*\).*/\1/p' "${SEMGREP_SCAN_ROOT}/.semgrep/rules.tsv" | head -n1)"
    semgrep_gitlink_commit="$(git -C "${SEMGREP_SCAN_ROOT}" rev-parse HEAD:.semgrep/rules 2>/dev/null || true)"
    if [[ -z "$semgrep_manifest_commit" || "$semgrep_manifest_commit" != "$semgrep_gitlink_commit" ]]; then
      printf 'FAIL: .semgrep/rules.tsv was generated for submodule %s but the pinned gitlink is %s\n' "${semgrep_manifest_commit:-?}" "${semgrep_gitlink_commit:-?}" >"$SEMGREP_STATUS_FILE"
      echo "[validate] the manifest header and the .semgrep/rules gitlink disagree; re-run scripts/semgrep-refresh-rules.sh so they describe the same snapshot." >&2
      exit 1
    fi
    semgrep_snapshot_epoch="$(date -u -d "${semgrep_snapshot}" +%s 2>/dev/null || date -u -j -f '%Y-%m-%d' "${semgrep_snapshot}" +%s)"
    semgrep_age_days=$(( ( $(date -u +%s) - semgrep_snapshot_epoch ) / 86400 ))
    if (( semgrep_age_days < 0 )); then
      printf 'FAIL: semgrep ruleset snapshot date %s is in the future\n' "$semgrep_snapshot" >"$SEMGREP_STATUS_FILE"
      echo "[validate] .semgrep/rules.tsv claims snapshot ${semgrep_snapshot}, which is after today (UTC); a future date would defeat the cadence check." >&2
      exit 1
    elif (( semgrep_age_days > 120 )); then
      printf 'FAIL: semgrep ruleset snapshot is %s days old (limit 120)\n' "$semgrep_age_days" >"$SEMGREP_STATUS_FILE"
      echo "[validate] semgrep ruleset snapshot ${semgrep_snapshot} is ${semgrep_age_days} days old; run 'bash scripts/semgrep-refresh-rules.sh' (cadence: 90 days, hard limit 120)." >&2
      exit 1
    elif (( semgrep_age_days > 90 )); then
      echo "[validate] WARN: semgrep ruleset snapshot ${semgrep_snapshot} is ${semgrep_age_days} days old; refresh is due (cadence: 90 days)." >&2
    fi
    # Every manifest row must name the file its id denotes — a registry id is
    # the rule file's path (dots for slashes, no extension) plus the rule's
    # own id — and that file must declare the id. Without the path rule a
    # manifest of 900 fabricated ids could all point at one valid file and
    # "pin" a gate that runs almost nothing. Ids are unique, and both the
    # rule count and the distinct-file count have floors so a resolver defect
    # cannot quietly hollow the gate out.
    SEMGREP_MANIFEST_MIN_RULES=900
    SEMGREP_MANIFEST_MIN_FILES=850
    SEMGREP_CONFIGS=()
    semgrep_manifest_rules=0
    if [[ -n "$(grep -v '^#' "${SEMGREP_SCAN_ROOT}/.semgrep/rules.tsv" | cut -f1 | sort | uniq -d)" ]]; then
      printf 'FAIL: .semgrep/rules.tsv has duplicate rule ids\n' >"$SEMGREP_STATUS_FILE"
      echo "[validate] .semgrep/rules.tsv contains duplicate rule ids; re-run scripts/semgrep-refresh-rules.sh." >&2
      exit 1
    fi
    # Some upstream files hold several rules, so a file may appear on more
    # than one row; it is passed to semgrep once.
    semgrep_seen_files=" "
    # Existence is checked against the submodule's index, not the filesystem:
    # on a case-insensitive disk a wrongly-cased path would pass here and
    # fail on the Linux runner.
    semgrep_index_file="${VALIDATION_ARTIFACT_DIR}/semgrep-rules-index.txt"
    git -C "${semgrep_rules_dir}" ls-files >"$semgrep_index_file"
    while IFS=$'\t' read -r semgrep_rule_id semgrep_rule_file; do
      [[ -z "$semgrep_rule_id" || "$semgrep_rule_id" == \#* ]] && continue
      if [[ ! "$semgrep_rule_id" =~ ^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)+$ || ! "$semgrep_rule_file" =~ ^[A-Za-z0-9_/-]+\.ya?ml$ ]]; then
        printf 'FAIL: .semgrep/rules.tsv row is malformed: %s\t%s\n' "$semgrep_rule_id" "$semgrep_rule_file" >"$SEMGREP_STATUS_FILE"
        echo "[validate] .semgrep/rules.tsv row '${semgrep_rule_id}' -> '${semgrep_rule_file}' is not a registry id and a relative rule path." >&2
        exit 1
      fi
      # Registry ids are lower-case; a few upstream files are not, so the
      # path rule is compared case-insensitively while the index lookup below
      # is exact.
      semgrep_expected_file="${semgrep_rule_id%.*}"
      semgrep_expected_file="${semgrep_expected_file//./\/}"
      semgrep_actual_stem="$(printf '%s' "${semgrep_rule_file%.*}" | tr '[:upper:]' '[:lower:]')"
      if [[ "$semgrep_actual_stem" != "$semgrep_expected_file" ]]; then
        printf 'FAIL: .semgrep/rules.tsv maps %s to %s, not to the file that id denotes\n' "$semgrep_rule_id" "$semgrep_rule_file" >"$SEMGREP_STATUS_FILE"
        echo "[validate] .semgrep/rules.tsv maps ${semgrep_rule_id} to ${semgrep_rule_file}; a registry id is its rule file's path, so this row is not a pin of that rule." >&2
        exit 1
      fi
      if ! grep -Fxq -- "$semgrep_rule_file" "$semgrep_index_file"; then
        printf 'FAIL: semgrep rule file missing from the pinned submodule: %s\n' "$semgrep_rule_file" >"$SEMGREP_STATUS_FILE"
        echo "[validate] .semgrep/rules.tsv names ${semgrep_rule_file} (${semgrep_rule_id}) but it is not in .semgrep/rules; re-run scripts/semgrep-refresh-rules.sh." >&2
        exit 1
      fi
      semgrep_rule_leaf="${semgrep_rule_id##*.}"
      if ! grep -qE "^[[:space:]]*(-[[:space:]]*)?id:[[:space:]]*(${semgrep_rule_leaf}|${semgrep_rule_id})[[:space:]]*$" "${semgrep_rules_dir}/${semgrep_rule_file}"; then
        printf 'FAIL: %s does not declare rule %s\n' "$semgrep_rule_file" "$semgrep_rule_id" >"$SEMGREP_STATUS_FILE"
        echo "[validate] .semgrep/rules.tsv maps ${semgrep_rule_id} to ${semgrep_rule_file}, but that file does not declare it; re-run scripts/semgrep-refresh-rules.sh." >&2
        exit 1
      fi
      semgrep_manifest_rules=$(( semgrep_manifest_rules + 1 ))
      if [[ "$semgrep_seen_files" != *" ${semgrep_rule_file} "* ]]; then
        semgrep_seen_files+="${semgrep_rule_file} "
        SEMGREP_CONFIGS+=("--config=.semgrep/rules/${semgrep_rule_file}")
      fi
    done <"${SEMGREP_SCAN_ROOT}/.semgrep/rules.tsv"
    if (( ${#SEMGREP_CONFIGS[@]} < SEMGREP_MANIFEST_MIN_FILES )); then
      printf 'FAIL: .semgrep/rules.tsv resolved to %s distinct rule files (floor %s)\n' "${#SEMGREP_CONFIGS[@]}" "$SEMGREP_MANIFEST_MIN_FILES" >"$SEMGREP_STATUS_FILE"
      echo "[validate] only ${#SEMGREP_CONFIGS[@]} distinct rule files in .semgrep/rules.tsv (floor ${SEMGREP_MANIFEST_MIN_FILES}); a shrunken manifest is a hollowed-out gate, not a pin." >&2
      exit 1
    fi
    if (( semgrep_manifest_rules < SEMGREP_MANIFEST_MIN_RULES )); then
      printf 'FAIL: .semgrep/rules.tsv resolved to %s rules (floor %s)\n' "$semgrep_manifest_rules" "$SEMGREP_MANIFEST_MIN_RULES" >"$SEMGREP_STATUS_FILE"
      echo "[validate] only ${semgrep_manifest_rules} rules in .semgrep/rules.tsv (floor ${SEMGREP_MANIFEST_MIN_RULES}); a shrunken manifest is a hollowed-out gate, not a pin." >&2
      exit 1
    fi
    if docker run --rm -v "${SEMGREP_SCAN_ROOT}":/src -w /src \
      semgrep/semgrep:1.172.0@sha256:65dcd4408adda7c183a6b4550cb1e9b19f7f627a6fbb7e0559bd466bedc44d7b \
      semgrep scan "${SEMGREP_CONFIGS[@]}" --metrics=off --disable-version-check --error "${SEMGREP_TARGETS[@]}" >"$SEMGREP_OUTPUT_FILE" 2>&1; then
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
