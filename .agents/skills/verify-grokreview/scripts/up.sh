#!/usr/bin/env bash
# Start Postgres + sandbox (compose) and a Next dev server on $PORT for verification.
set -euo pipefail

ROOT="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
PORT="${PORT:-3100}"
STATE="$ROOT/.verify/state"
cd "$ROOT"
mkdir -p "$STATE"

if [[ -f "$STATE/dev.pid" ]] && kill -0 "$(cat "$STATE/dev.pid")" 2>/dev/null; then
  echo "dev server already running (pid $(cat "$STATE/dev.pid")); run doctor.sh or down.sh" >&2
  exit 1
fi
if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "port $PORT is taken by something this script didn't start; pick another with PORT=" >&2
  exit 1
fi

running="$(docker compose ps --status running --services 2>/dev/null || true)"
: > "$STATE/started-services"
for svc in postgres sandbox; do
  grep -qx "$svc" <<<"$running" || echo "$svc" >> "$STATE/started-services"
done
docker compose up -d --wait postgres sandbox

# Keys come from the user's shell profile, so the server is launched through zsh -ic.
# set -m puts the server in its own process group so down.sh can kill exactly it.
set -m
zsh -ic "
  export DATABASE_URL='postgres://postgres:postgres@localhost:5432/grokreview?sslmode=disable'
  export SANDBOX_URL='http://localhost:8080' SANDBOX_TOKEN=\"\${SANDBOX_TOKEN:-dev-sandbox-token}\"
  export GITHUB_TOKEN=\"\${GITHUB_TOKEN:-\$(gh auth token 2>/dev/null)}\"
  exec pnpm exec next dev -p $PORT
" > "$STATE/dev.log" 2>&1 < /dev/null &
echo $! > "$STATE/dev.pid"
echo "$PORT" > "$STATE/port"
set +m

for _ in $(seq 1 60); do
  if curl -fs -o /dev/null "http://localhost:$PORT/"; then
    echo "ready: http://localhost:$PORT (pid $(cat "$STATE/dev.pid"), log .verify/state/dev.log)"
    exit 0
  fi
  kill -0 "$(cat "$STATE/dev.pid")" 2>/dev/null || { echo "dev server exited:" >&2; tail -20 "$STATE/dev.log" >&2; exit 1; }
  sleep 1
done
echo "dev server not answering after 60s; see .verify/state/dev.log" >&2
exit 1
