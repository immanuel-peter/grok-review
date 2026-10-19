#!/usr/bin/env bash
# Stop what up.sh started. Leaves .verify/runs/ (evidence) and the Postgres volume (review cache) alone.
set -uo pipefail

ROOT="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
STATE="$ROOT/.verify/state"
cd "$ROOT"

agent-browser --session verify-grokreview close >/dev/null 2>&1 || true

if [[ -f "$STATE/dev.pid" ]]; then
  PID="$(cat "$STATE/dev.pid")"
  kill -TERM -- "-$PID" 2>/dev/null || true
  for _ in $(seq 1 10); do kill -0 "$PID" 2>/dev/null || break; sleep 1; done
  kill -KILL -- "-$PID" 2>/dev/null || true
  echo "stopped dev server (pgid $PID)"
fi

if [[ -s "$STATE/started-services" ]]; then
  docker compose stop $(cat "$STATE/started-services")
fi

rm -rf "$STATE"
echo "evidence kept in .verify/runs/"
