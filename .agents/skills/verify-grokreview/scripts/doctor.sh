#!/usr/bin/env bash
# Read-only: is the verification instance up, ours, and able to run reviews?
set -uo pipefail

ROOT="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
STATE="$ROOT/.verify/state"
cd "$ROOT"
ok=1
check() { if eval "$2" >/dev/null 2>&1; then echo "ok    $1"; else echo "FAIL  $1"; ok=0; fi; }

PORT="$(cat "$STATE/port" 2>/dev/null || echo 3100)"
PID="$(cat "$STATE/dev.pid" 2>/dev/null || echo none)"

check "dev server pid $PID alive" "kill -0 $PID"
check "port $PORT owned by our process group" \
  "lsof -nP -iTCP:$PORT -sTCP:LISTEN -t | xargs -I{} ps -o pgid= -p {} | grep -qw $PID"
check "app answers on :$PORT" "curl -fsS -o /dev/null http://localhost:$PORT/"
check "sandbox /healthz" "curl -fsS http://localhost:8080/healthz"
check "postgres accepting connections" "docker compose exec -T postgres pg_isready -U postgres"
check "XAI_API_KEY set in shell" "zsh -ic '[ -n \"\$XAI_API_KEY\" ]'"
check "GitHub token available" "zsh -ic '[ -n \"\${GITHUB_TOKEN:-\$(gh auth token 2>/dev/null)}\" ]'"

echo "cached reviews:"
docker compose exec -T postgres psql -U postgres -d grokreview -Atc \
  "select owner||'/'||repo||'#'||pull_number||' @'||left(head_sha,7)||' '||updated_at::timestamp(0) from pr_review_cache order by updated_at desc limit 10" 2>/dev/null \
  | sed 's/^/  /' || echo "  (table not created yet: no review has run)"

[[ $ok == 1 ]]
