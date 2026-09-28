#!/usr/bin/env bash
# Start / stop / restart the live monitor (backend :7020) and Vite UI (frontend :5173).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RUN="$ROOT/.run"

# nvm default is often 18; the UI needs 22.12+. Prefer an already-installed 22.
prefer_node22() {
  local raw major minor
  if command -v node >/dev/null 2>&1; then
    raw="$(node -v 2>/dev/null || true)"
    raw="${raw#v}"
    major="${raw%%.*}"
    minor="${raw#*.}"
    minor="${minor%%.*}"
    if [[ "${major:-0}" -gt 22 || ( "${major:-0}" -eq 22 && "${minor:-0}" -ge 12 ) ]]; then
      return 0
    fi
  fi
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  if [[ -s "$NVM_DIR/nvm.sh" ]]; then
    # shellcheck disable=SC1091
    . "$NVM_DIR/nvm.sh"
    nvm use 22 >/dev/null 2>&1 || true
  fi
}
prefer_node22
BACKEND_PORT="${ZOTO_VIZ_PORT:-7020}"
FRONTEND_PORT="${ZOTO_VIZ_FRONTEND_PORT:-5173}"
BACKEND_BIND="${ZOTO_VIZ_BIND:-127.0.0.1}"

usage() {
  echo "usage: $0 <start|stop|restart|status> <frontend|backend|both>" >&2
  exit 2
}

need() {
  mkdir -p "$RUN"
}

py() {
  if [[ -x "$ROOT/.venv/bin/python" ]]; then
    echo "$ROOT/.venv/bin/python"
  else
    echo "python3"
  fi
}

port_pids() {
  local port="$1"
  if command -v fuser >/dev/null 2>&1; then
    fuser "${port}/tcp" 2>/dev/null | tr -s ' ' '\n' | grep -E '^[0-9]+$' || true
  elif command -v lsof >/dev/null 2>&1; then
    lsof -ti "tcp:${port}" -sTCP:LISTEN 2>/dev/null || true
  else
    ss -lptn "sport = :${port}" 2>/dev/null | grep -oE 'pid=[0-9]+' | cut -d= -f2 || true
  fi
}

port_up() {
  local port="$1"
  [[ -n "$(port_pids "$port")" ]]
}

kill_pids() {
  local pid
  for pid in "$@"; do
    [[ -n "$pid" && -d "/proc/$pid" ]] || continue
    kill -TERM "$pid" 2>/dev/null || true
  done
}

kill_port() {
  local port="$1" pid
  mapfile -t pids < <(port_pids "$port")
  kill_pids "${pids[@]:-}"
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    port_up "$port" || return 0
    sleep 0.2
  done
  mapfile -t pids < <(port_pids "$port")
  for pid in "${pids[@]:-}"; do
    [[ -n "$pid" ]] && kill -KILL "$pid" 2>/dev/null || true
  done
}

wait_port() {
  local port="$1" n=0
  while (( n < 50 )); do
    port_up "$port" && return 0
    sleep 0.2
    n=$((n + 1))
  done
  return 1
}

alive_pidfile() {
  local file="$1"
  [[ -f "$file" ]] || return 1
  local pid
  pid="$(cat "$file" 2>/dev/null || true)"
  [[ -n "$pid" && -d "/proc/$pid" ]]
}

stop_backend() {
  need
  if alive_pidfile "$RUN/backend.pid"; then
    kill_pids "$(cat "$RUN/backend.pid")"
  fi
  kill_port "$BACKEND_PORT"
  rm -f "$RUN/backend.pid"
  echo "backend stopped (:${BACKEND_PORT})"
}

stop_frontend() {
  need
  if alive_pidfile "$RUN/frontend.pid"; then
    local pid pgid
    pid="$(cat "$RUN/frontend.pid")"
    pgid="$(ps -o pgid= -p "$pid" 2>/dev/null | tr -d ' ' || true)"
    if [[ -n "$pgid" ]]; then
      kill -TERM -- "-$pgid" 2>/dev/null || kill_pids "$pid"
    else
      kill_pids "$pid"
    fi
  fi
  kill_port "$FRONTEND_PORT"
  rm -f "$RUN/frontend.pid"
  echo "frontend stopped (:${FRONTEND_PORT})"
}

monitor_unit_installed() {
  systemctl --user list-unit-files zoto-viz-monitor.service --no-legend 2>/dev/null | grep -q .
}

start_backend() {
  need
  # The user unit is the one listener. A second `python -m service.monitor`
  # from this script holds 127.0.0.1 and the unit then crash-loops on 0.0.0.0.
  if monitor_unit_installed; then
    stop_backend
    systemctl --user restart zoto-viz-monitor
    if wait_port "$BACKEND_PORT"; then
      echo "backend via zoto-viz-monitor :${BACKEND_PORT}/"
      return 0
    fi
    echo "backend failed to bind :${BACKEND_PORT} — see journalctl --user -u zoto-viz-monitor" >&2
    return 1
  fi
  if port_up "$BACKEND_PORT"; then
    echo "backend already running http://${BACKEND_BIND}:${BACKEND_PORT}/"
    return 0
  fi
  local python
  python="$(py)"
  (
    cd "$ROOT"
    exec "$python" -m service.monitor --bind "$BACKEND_BIND" --port "$BACKEND_PORT"
  ) >>"$RUN/backend.log" 2>&1 &
  echo $! >"$RUN/backend.pid"
  if wait_port "$BACKEND_PORT"; then
    echo "backend http://${BACKEND_BIND}:${BACKEND_PORT}/  (log .run/backend.log)"
  else
    echo "backend failed to bind :${BACKEND_PORT} — see .run/backend.log" >&2
    return 1
  fi
}

start_frontend() {
  need
  if port_up "$FRONTEND_PORT"; then
    echo "frontend already running http://127.0.0.1:${FRONTEND_PORT}/"
    return 0
  fi
  if [[ ! -d "$ROOT/web/node_modules" ]]; then
    echo "frontend: installing web deps"
    pnpm --dir "$ROOT/web" install
  fi
  (
    cd "$ROOT/web"
    exec setsid pnpm exec vite --host 127.0.0.1 --port "$FRONTEND_PORT"
  ) >>"$RUN/frontend.log" 2>&1 &
  echo $! >"$RUN/frontend.pid"
  if wait_port "$FRONTEND_PORT"; then
    echo "frontend http://127.0.0.1:${FRONTEND_PORT}/  (proxies /api and /ws to :${BACKEND_PORT})"
  else
    echo "frontend failed to bind :${FRONTEND_PORT} — see .run/frontend.log" >&2
    return 1
  fi
}

status_one() {
  local name="$1" port="$2" file="$3"
  if port_up "$port"; then
    local pids
    pids="$(port_pids "$port" | tr '\n' ' ')"
    echo "$name running :${port}  pids ${pids}"
  elif alive_pidfile "$file"; then
    echo "$name pidfile $(cat "$file") but nothing on :${port}"
  else
    echo "$name stopped"
  fi
}

cmd="${1:-}"
target="${2:-both}"
[[ "$cmd" =~ ^(start|stop|restart|status)$ ]] || usage
[[ "$target" =~ ^(frontend|backend|both)$ ]] || usage

case "$cmd" in
  status)
    if [[ "$target" == "backend" || "$target" == "both" ]]; then
      status_one backend "$BACKEND_PORT" "$RUN/backend.pid"
    fi
    if [[ "$target" == "frontend" || "$target" == "both" ]]; then
      status_one frontend "$FRONTEND_PORT" "$RUN/frontend.pid"
    fi
    ;;
  stop)
    if [[ "$target" == "frontend" || "$target" == "both" ]]; then
      stop_frontend
    fi
    if [[ "$target" == "backend" || "$target" == "both" ]]; then
      stop_backend
    fi
    ;;
  start)
    if [[ "$target" == "backend" || "$target" == "both" ]]; then
      start_backend
    fi
    if [[ "$target" == "frontend" || "$target" == "both" ]]; then
      start_frontend
    fi
    ;;
  restart)
    if [[ "$target" == "frontend" || "$target" == "both" ]]; then
      stop_frontend
    fi
    if [[ "$target" == "backend" || "$target" == "both" ]]; then
      stop_backend
    fi
    if [[ "$target" == "backend" || "$target" == "both" ]]; then
      start_backend
    fi
    if [[ "$target" == "frontend" || "$target" == "both" ]]; then
      start_frontend
    fi
    ;;
esac
