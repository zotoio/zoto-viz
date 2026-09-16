#!/usr/bin/env bash
# Cursor stop: bounce the live monitor when service/*.py is newer than the process.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
if [[ -x "$ROOT/.venv/bin/python" ]]; then
  PY="$ROOT/.venv/bin/python"
else
  PY="python3"
fi
export PYTHONPATH="$ROOT"
# Drain hook stdin (the stop payload) so the pipe cannot stall.
cat >/dev/null
out="$("$PY" -m service.monitor_reload --hook --if-stale)" || true
[[ -n "${out:-}" ]] || out='{}'
printf '%s\n' "$out"
