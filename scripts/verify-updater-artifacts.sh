#!/usr/bin/env bash
# #241: assert a release's asset list carries a working updater feed.
#
# Promotion emits latest.json, a signed .app.tar.gz and its .sig only when
# TAURI_SIGNING_PRIVATE_KEY is set; native-publish-release.sh uploads whatever it
# is handed. Between those two facts a release could publish successfully with a
# dead update feed — which is what happened to v0.1.0 (#224): a single DMG asset,
# no latest.json, and every installed copy's update check 404ing.
#
# Split into its own script rather than living inline in the publish path so the
# rule can be exercised directly with fixture asset lists.
#
# Usage:  verify-updater-artifacts.sh <asset-path>...
# Exit 0 when the triplet is present, 1 when anything is missing (listing what).
set -euo pipefail

if (( $# == 0 )); then
  echo "ERROR: no release assets to verify — expected at least the updater triplet." >&2
  exit 1
fi

# Matched with bash globs rather than `printf ... | grep -q`. Under the
# `set -o pipefail` above, grep -q exits on its first match, printf takes SIGPIPE,
# and pipefail reports the whole pipeline as failed — turning a present artifact
# into a "missing" one, non-deterministically depending on whether printf finished
# writing first. This is not hypothetical: the pipe version reported latest.json
# missing from a list that contained it.
has_suffix() {
  local suffix="$1"
  shift
  local candidate
  for candidate in "$@"; do
    [[ "$candidate" == *"$suffix" ]] && return 0
  done
  return 1
}

# latest.json is matched on the exact basename, not as a suffix: "*latest.json"
# would also accept a file named "not-latest.json" or "v2-latest.json" while the
# real feed manifest was absent. Unlikely in a deterministic pipeline, but the
# whole point of this gate is to not take "looks about right" for an answer.
has_basename() {
  local want="$1"
  shift
  local candidate
  for candidate in "$@"; do
    [[ "${candidate##*/}" == "$want" ]] && return 0
  done
  return 1
}

missing=()
has_basename "latest.json" "$@" || missing+=("latest.json")
# Checked in this order for readability only; the glob for the tarball cannot be
# satisfied by the signature file, since "foo.app.tar.gz.sig" does not end in
# ".app.tar.gz".
has_suffix ".app.tar.gz" "$@" || missing+=("<app>.app.tar.gz")
has_suffix ".app.tar.gz.sig" "$@" || missing+=("<app>.app.tar.gz.sig")

if (( ${#missing[@]} > 0 )); then
  echo "ERROR: release is missing updater artifacts:" >&2
  printf '         %s\n' "${missing[@]}" >&2
  echo "       Refusing to publish: installed apps would not discover this version." >&2
  echo "       Re-run promotion with TAURI_SIGNING_PRIVATE_KEY set, or unset" >&2
  echo "       REQUIRE_UPDATER_ARTIFACTS if this is deliberately a non-updating build." >&2
  echo "       Assets resolved for upload:" >&2
  printf '         %s\n' "$@" >&2
  exit 1
fi

echo "Updater artifacts present (latest.json + signed .app.tar.gz + .sig)."
