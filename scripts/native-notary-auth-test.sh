#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT_PATH="$ROOT_DIR/scripts/native-notarize.sh"

run_mode() {
  env "$@" MACOS_NOTARY_DRY_RUN=1 bash "$SCRIPT_PATH"
}

PROFILE_OUTPUT="$(run_mode MACOS_NOTARY_PROFILE=FixtureProfile)"
API_KEY_OUTPUT="$(run_mode MACOS_NOTARY_KEY_ID=ABC123DEF4 MACOS_NOTARY_ISSUER=00000000-0000-0000-0000-000000000000 MACOS_NOTARY_KEY_BASE64=ZmFrZS1rZXk=)"
APPLE_ID_OUTPUT="$(run_mode MACOS_NOTARY_APPLE_ID=ci@example.com MACOS_NOTARY_APP_PASSWORD=app-specific-password MACOS_NOTARY_TEAM_ID=TEAMID1234)"

grep -q '^mode=keychain-profile$' <<<"$PROFILE_OUTPUT"
grep -q '^profile=FixtureProfile$' <<<"$PROFILE_OUTPUT"

grep -q '^mode=app-store-connect-key$' <<<"$API_KEY_OUTPUT"
grep -q '^key_id=ABC123DEF4$' <<<"$API_KEY_OUTPUT"
grep -q '^issuer=00000000-0000-0000-0000-000000000000$' <<<"$API_KEY_OUTPUT"
grep -q '^key_source=base64$' <<<"$API_KEY_OUTPUT"

grep -q '^mode=apple-id$' <<<"$APPLE_ID_OUTPUT"
grep -q '^apple_id=ci@example.com$' <<<"$APPLE_ID_OUTPUT"
grep -q '^team_id=TEAMID1234$' <<<"$APPLE_ID_OUTPUT"

echo "Portable notarization auth modes resolved correctly."
