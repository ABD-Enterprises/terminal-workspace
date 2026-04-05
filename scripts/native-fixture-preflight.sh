#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT_DIR/scripts/load-env.sh"

MODE="${1:-transport}"
TMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/termsnip-fixture-preflight.XXXXXX")"
LOG_PATH="$TMP_ROOT/sshd.log"
PORT=""
SSHD_PID=""

cleanup() {
  if [[ -n "$SSHD_PID" ]]; then
    kill "$SSHD_PID" >/dev/null 2>&1 || true
    wait "$SSHD_PID" >/dev/null 2>&1 || true
  fi
  rm -rf "$TMP_ROOT"
}

trap cleanup EXIT

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "Local fixture preflight is only required on macOS. Skipping on $(uname -s)." >&2
  exit 0
fi

for binary in /usr/bin/ssh-keygen /usr/bin/ssh-keyscan /usr/sbin/sshd; do
  if [[ ! -x "$binary" ]]; then
    echo "Missing required fixture binary: $binary" >&2
    exit 1
  fi
done

reserve_port() {
  python3 <<'PY'
import socket

sock = socket.socket()
sock.bind(("127.0.0.1", 0))
print(sock.getsockname()[1])
sock.close()
PY
}

PORT="$(reserve_port)"
/usr/bin/ssh-keygen -q -t ed25519 -N '' -f "$TMP_ROOT/ssh_host_ed25519_key" >/dev/null
touch "$TMP_ROOT/authorized_keys"

cat >"$TMP_ROOT/sshd_config" <<EOF
Port $PORT
ListenAddress 127.0.0.1
HostKey $TMP_ROOT/ssh_host_ed25519_key
PidFile $TMP_ROOT/sshd.pid
AuthorizedKeysFile $TMP_ROOT/authorized_keys
PasswordAuthentication no
KbdInteractiveAuthentication no
ChallengeResponseAuthentication no
UsePAM no
PubkeyAuthentication yes
StrictModes no
PermitRootLogin no
PrintMotd no
PermitTTY yes
AllowTcpForwarding yes
GatewayPorts yes
UseDNS no
LogLevel VERBOSE
Subsystem sftp internal-sftp
EOF

/usr/sbin/sshd -D -f "$TMP_ROOT/sshd_config" -E "$LOG_PATH" >/dev/null 2>&1 &
SSHD_PID="$!"

for _ in {1..100}; do
  if ! kill -0 "$SSHD_PID" >/dev/null 2>&1; then
    break
  fi

  if [[ -f "$LOG_PATH" ]] && grep -q "Server listening on 127.0.0.1 port $PORT" "$LOG_PATH"; then
    break
  fi

  sleep 0.05
done

if ! kill -0 "$SSHD_PID" >/dev/null 2>&1; then
  echo "Native fixture preflight failed while starting temporary sshd for $MODE fixtures." >&2
  [[ -f "$LOG_PATH" ]] && cat "$LOG_PATH" >&2
  echo "Re-run from an unsandboxed macOS shell or rely on the macOS CI fixtures." >&2
  exit 2
fi

if ! grep -q "Server listening on 127.0.0.1 port $PORT" "$LOG_PATH"; then
  echo "Native fixture preflight timed out while waiting for temporary sshd startup." >&2
  [[ -f "$LOG_PATH" ]] && cat "$LOG_PATH" >&2
  echo "Re-run from an unsandboxed macOS shell or rely on the macOS CI fixtures." >&2
  exit 2
fi

if ! /usr/bin/ssh-keyscan -T 5 -p "$PORT" 127.0.0.1 >/dev/null 2>"$TMP_ROOT/ssh-keyscan.log"; then
  echo "Native fixture preflight could not scan the temporary localhost sshd for $MODE fixtures." >&2
  cat "$TMP_ROOT/ssh-keyscan.log" >&2
  echo "Re-run from an unsandboxed macOS shell or rely on the macOS CI fixtures." >&2
  exit 2
fi

echo "Native fixture preflight passed for $MODE fixtures on port $PORT."
