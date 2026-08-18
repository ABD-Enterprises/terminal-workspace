#!/usr/bin/env bash
set -euo pipefail

# #185: the only automated path that runs the REAL apps/desktop/server/backend.mjs.
#
# Everything else proves UI wiring against mocks: playwright boots vite in demo
# mode, and the integration suite exercises resetDemoBackend() or extracted
# helper modules. None of it binds a port. So a regression in the SSH/SFTP
# transport, the auth gate, or the session lifecycle could pass lint, vitest and
# e2e while the shipped app could not open a session.
#
# This stands up a throwaway sshd, boots the real backend against it, and drives
# connect / terminal I/O / exec / SFTP through its actual HTTP and WebSocket
# surface. macOS only, matching the Rust sshd fixture already in the same CI job.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "[backend-fixture] skipped (macOS only — matches the Rust sshd fixture)"
  exit 0
fi

for tool in /usr/sbin/sshd ssh-keygen node; do
  if ! command -v "$tool" >/dev/null 2>&1 && [[ ! -x "$tool" ]]; then
    echo "[backend-fixture] required tool missing: $tool" >&2
    exit 1
  fi
done

FIXTURE_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/tw-backend-fixture.XXXXXX")"
SSHD_PID=""
BACKEND_PID=""

cleanup() {
  local status=$?
  # Print logs BEFORE teardown on failure — a fixture that dies silently is
  # worse than no fixture, because the next reader assumes infrastructure.
  if [[ $status -ne 0 ]]; then
    echo "[backend-fixture] FAILED (exit $status). Logs follow." >&2
    for log in "$FIXTURE_ROOT/sshd.log" "$FIXTURE_ROOT/backend.log"; do
      if [[ -s "$log" ]]; then
        echo "--- $log" >&2
        tail -40 "$log" >&2 || true
      fi
    done
  fi
  # Graceful first, then escalate. A backend that ignores SIGTERM must not
  # survive the run and hold its port for the next one.
  for pid in "$BACKEND_PID" "$SSHD_PID"; do
    [[ -n "$pid" ]] || continue
    kill -TERM "$pid" 2>/dev/null || true
  done
  for _ in $(seq 1 20); do
    local alive=0
    for pid in "$BACKEND_PID" "$SSHD_PID"; do
      [[ -n "$pid" ]] || continue
      kill -0 "$pid" 2>/dev/null && alive=1
    done
    [[ $alive -eq 0 ]] && break
    sleep 0.1
  done
  for pid in "$BACKEND_PID" "$SSHD_PID"; do
    [[ -n "$pid" ]] || continue
    kill -KILL "$pid" 2>/dev/null || true
  done
  rm -rf "$FIXTURE_ROOT"
  exit $status
}
# Installed BEFORE any child starts, so an early failure still reaps.
trap cleanup EXIT HUP INT TERM

pick_port() {
  node -e 'const s=require("net").createServer();s.listen(0,"127.0.0.1",()=>{const p=s.address().port;s.close(()=>console.log(p));});'
}

SSH_PORT="$(pick_port)"
BACKEND_PORT="$(pick_port)"

ssh-keygen -t ed25519 -N "" -q -f "$FIXTURE_ROOT/id_fixture"
ssh-keygen -t ed25519 -N "" -q -f "$FIXTURE_ROOT/host_ed25519"
cp "$FIXTURE_ROOT/id_fixture.pub" "$FIXTURE_ROOT/authorized_keys"
chmod 600 "$FIXTURE_ROOT/authorized_keys"

mkdir -p "$FIXTURE_ROOT/sftproot"
echo "fixture-payload" > "$FIXTURE_ROOT/sftproot/fixture-file.txt"

cat > "$FIXTURE_ROOT/sshd_config" <<EOF
Port $SSH_PORT
ListenAddress 127.0.0.1
HostKey $FIXTURE_ROOT/host_ed25519
PidFile $FIXTURE_ROOT/sshd.pid
AuthorizedKeysFile $FIXTURE_ROOT/authorized_keys
# StrictModes off because the fixture lives under a temp dir the checker rejects.
StrictModes no
UsePAM no
PasswordAuthentication no
PubkeyAuthentication yes
PermitRootLogin no
Subsystem sftp internal-sftp
LogLevel VERBOSE
EOF

/usr/sbin/sshd -f "$FIXTURE_ROOT/sshd_config" -E "$FIXTURE_ROOT/sshd.log"
# sshd daemonizes, so its pid comes from the pidfile rather than $!.
for _ in $(seq 1 50); do
  [[ -s "$FIXTURE_ROOT/sshd.pid" ]] && break
  sleep 0.1
done
SSHD_PID="$(cat "$FIXTURE_ROOT/sshd.pid" 2>/dev/null || true)"
if [[ -z "$SSHD_PID" ]]; then
  echo "[backend-fixture] sshd did not start" >&2
  exit 1
fi
echo "[backend-fixture] sshd listening on 127.0.0.1:$SSH_PORT (pid $SSHD_PID)"

# A deterministic token and one unique Origin, so the client can exercise each
# credential on its own. A fixture TMPDIR keeps the backend away from any real
# token sidecar on this machine.
export TERMSNIP_BACKEND_TOKEN="fixture-token-0123456789abcdef0123456789abcdef"
export TERMSNIP_ALLOWED_ORIGINS="http://backend-fixture.termsnip.invalid"
export TERMSNIP_BACKEND_PORT="$BACKEND_PORT"

TMPDIR="$FIXTURE_ROOT/tmp" node apps/desktop/server/backend.mjs \
  >"$FIXTURE_ROOT/backend.log" 2>&1 &
BACKEND_PID=$!
mkdir -p "$FIXTURE_ROOT/tmp"

# Readiness by probe, never a fixed sleep: the port is the actual signal.
for _ in $(seq 1 100); do
  if ! kill -0 "$BACKEND_PID" 2>/dev/null; then
    echo "[backend-fixture] backend exited during startup" >&2
    exit 1
  fi
  if node -e '
const net=require("net");
const s=net.connect(Number(process.argv[1]),"127.0.0.1");
s.on("connect",()=>{s.destroy();process.exit(0);});
s.on("error",()=>process.exit(1));
' "$BACKEND_PORT" 2>/dev/null; then
    break
  fi
  sleep 0.1
done
echo "[backend-fixture] backend listening on 127.0.0.1:$BACKEND_PORT (pid $BACKEND_PID)"

TW_FIXTURE_ROOT="$FIXTURE_ROOT" \
TW_BACKEND_PORT="$BACKEND_PORT" \
TW_SSH_PORT="$SSH_PORT" \
TW_SSH_USER="$(id -un)" \
TW_BACKEND_TOKEN="$TERMSNIP_BACKEND_TOKEN" \
TW_ALLOWED_ORIGIN="$TERMSNIP_ALLOWED_ORIGINS" \
  node tests/system/backend-transport-client.mjs

echo "[backend-fixture] PASS"
