#!/usr/bin/env bash

# Env-file precedence, highest first:
#
#   1. a variable already exported in the real process environment
#   2. .env          (git-ignored; local overrides)
#   3. .env.shared   (tracked; non-secret shared defaults)
#
# .env is read after .env.shared and replaces the shared value for the same
# key, which is what docs/development.md, docs/release.md and
# docs/operations.md describe. The real process environment still wins over
# both files, so an exported shell variable is never clobbered.
#
# A blank value in either file is a placeholder rather than an override, so a
# copy of .env.example (whose signing and token slots are empty) cannot blank
# out a shared default. The first occurrence of a key inside one file wins.
#
# Nothing is left in the sourcing shell's namespace except ROOT_DIR, which the
# previous loader also set: the helpers are unset and the working variables
# are given names that cannot collide with a caller's.

if [[ -n "${TERMSNIP_ENV_LOADED:-}" ]]; then
  return 0 2>/dev/null || exit 0
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

trim_whitespace() {
  local value="$1"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  printf '%s' "$value"
}

strip_wrapping_quotes() {
  local value="$1"
  if [[ "$value" == \"*\" && "$value" == *\" ]]; then
    value="${value:1:${#value}-2}"
  elif [[ "$value" == \'*\' && "$value" == *\' ]]; then
    value="${value:1:${#value}-2}"
  fi
  printf '%s' "$value"
}

# Collected across both files, in the order the files are parsed.
LOAD_ENV_KEYS=()
LOAD_ENV_VALUES=()
LOAD_ENV_SOURCES=()

load_env_key_index() {
  local needle="$1"
  local index
  for ((index = 0; index < ${#LOAD_ENV_KEYS[@]}; index++)); do
    if [[ "${LOAD_ENV_KEYS[$index]}" == "$needle" ]]; then
      printf '%s' "$index"
      return 0
    fi
  done
  return 1
}

load_env_values_from_file() {
  local file_path="$1"
  local source="$2"
  local raw_line line key value index

  if [[ ! -f "$file_path" ]]; then
    return 0
  fi

  while IFS= read -r raw_line || [[ -n "$raw_line" ]]; do
    line="$(trim_whitespace "$raw_line")"

    if [[ -z "$line" || "$line" == \#* ]]; then
      continue
    fi

    if [[ "$line" == export\ * ]]; then
      line="${line#export }"
    fi

    if [[ "$line" != *=* ]]; then
      continue
    fi

    key="$(trim_whitespace "${line%%=*}")"
    value="$(strip_wrapping_quotes "$(trim_whitespace "${line#*=}")")"

    if [[ ! "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
      continue
    fi

    # A blank value is a placeholder, not an override.
    if [[ -z "$value" ]]; then
      continue
    fi

    if index="$(load_env_key_index "$key")"; then
      # The later file replaces the earlier one; a second occurrence inside the
      # same file does not.
      if [[ "${LOAD_ENV_SOURCES[$index]}" != "$source" ]]; then
        LOAD_ENV_VALUES[$index]="$value"
        LOAD_ENV_SOURCES[$index]="$source"
      fi
      continue
    fi

    LOAD_ENV_KEYS+=("$key")
    LOAD_ENV_VALUES+=("$value")
    LOAD_ENV_SOURCES+=("$source")
  done <"$file_path"
}

load_env_values_from_file "$ROOT_DIR/.env.shared" shared
load_env_values_from_file "$ROOT_DIR/.env" local

# The real process environment always wins: a variable that is already
# exported is left exactly as it is. The loop variables are named so they
# cannot collide with the sourcing script's own, and are unset below.
for ((load_env_index = 0; load_env_index < ${#LOAD_ENV_KEYS[@]}; load_env_index++)); do
  load_env_key="${LOAD_ENV_KEYS[$load_env_index]}"
  if [[ -n "${!load_env_key:-}" ]]; then
    continue
  fi
  export "$load_env_key=${LOAD_ENV_VALUES[$load_env_index]}"
done

unset LOAD_ENV_KEYS LOAD_ENV_VALUES LOAD_ENV_SOURCES load_env_index load_env_key
unset -f load_env_values_from_file load_env_key_index

export TERMSNIP_ENV_LOADED=1
