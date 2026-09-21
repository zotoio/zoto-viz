#!/usr/bin/env bash
# Fast-forward the checkout once a minute. On new commits: rebuild if needed,
# restart the live monitor + Vite, hard-reload the zoto-viz Chrome tab, then
# autoconsent and load plugin views that landed in the pull (single VIEW or mosaic).
#
#   bash scripts/pull-watch.sh          # loop
#   bash scripts/pull-watch.sh --once   # one pass
#
# Env: ZOTO_VIZ_PULL_WATCH_S (default 60), ZOTO_VIZ_PORT (7020),
# ZOTO_VIZ_FRONTEND_PORT (5173), ZOTO_VIZ_CHROME_DEBUG (9222, comma-separated).
# Dirty trees, merges, and missing upstream are skipped (never reset).
# Set ZOTO_VIZ_NO_AUTO_PULL=1 on the monitor if you want this script to be
# the only puller (the process already pulls every 5 minutes).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# nvm default is often 18; this repo and pnpm 12 need 22.12+.
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

INTERVAL="${ZOTO_VIZ_PULL_WATCH_S:-60}"
PORT="${ZOTO_VIZ_PORT:-7020}"
FRONT="${ZOTO_VIZ_FRONTEND_PORT:-5173}"
MCP="http://127.0.0.1:${PORT}/mcp"
UNIT="zoto-viz-monitor"
ONCE=0

log() { printf '%s %s\n' "$(date -Iseconds)" "$*"; }

usage() {
  echo "usage: $0 [--once]" >&2
  exit 2
}

for arg in "$@"; do
  case "$arg" in
    --once) ONCE=1 ;;
    -h|--help) usage ;;
    *) usage ;;
  esac
done

py() {
  if [[ -x "$ROOT/.venv/bin/python" ]]; then
    echo "$ROOT/.venv/bin/python"
  else
    echo "python3"
  fi
}

wait_port() {
  local port="$1" timeout="${2:-30}" i
  for ((i = 0; i < timeout * 5; i++)); do
    if "$(py)" - "$port" <<'PY'
import socket, sys
port = int(sys.argv[1])
try:
    with socket.create_connection(("127.0.0.1", port), timeout=0.3):
        raise SystemExit(0)
except OSError:
    raise SystemExit(1)
PY
    then
      return 0
    fi
    sleep 0.2
  done
  return 1
}

mcp() {
  local name="$1" args="${2:-{}}"
  curl -sS --max-time 8 -X POST "$MCP" \
    -H 'Content-Type: application/json' \
    -H 'Host: 127.0.0.1' \
    -d "$(jq -nc --arg n "$name" --argjson a "$args" \
      '{jsonrpc:"2.0",id:1,method:"tools/call",params:{name:$n,arguments:$a}}')"
}

changed_plugin_ids() {
  local file id
  declare -A seen=()
  while IFS= read -r file; do
    [[ "$file" == plugins/src/* ]] || continue
    id="${file#plugins/src/}"
    id="${id%%/*}"
    [[ -n "$id" && -f "$ROOT/plugins/src/$id/plugin.yml" ]] || continue
    seen["$id"]=1
  done
  for id in "${!seen[@]}"; do
    printf '%s\n' "$id"
  done
}

reload_chrome() {
  local ports="${ZOTO_VIZ_CHROME_DEBUG:-9222,9333,9223}"
  if "$(py)" - "$ports" "$PORT" "$FRONT" <<'PY'
import json, os, socket, sys, urllib.parse, urllib.request

ports = [int(p) for p in sys.argv[1].split(",") if p.strip().isdigit()]
want = (f":{sys.argv[2]}/", f":{sys.argv[3]}/", "zoto-viz")

def tabs(port):
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/json", timeout=0.8) as r:
            rows = json.load(r)
    except Exception:
        return []
    return rows if isinstance(rows, list) else []

def pick(rows):
    pages = [t for t in rows if str(t.get("type") or "") in {"page", "webview", ""}]
    scored = []
    for t in pages:
        blob = f"{t.get('url','')} {t.get('title','')}".lower()
        if any(w.lower() in blob for w in want):
            scored.append(t)
    return scored or [t for t in pages if "127.0.0.1" in str(t.get("url") or "")]

def reload_ws(url):
    u = urllib.parse.urlparse(url)
    host, port = u.hostname, u.port or (443 if u.scheme == "wss" else 80)
    key = os.urandom(16)
    import base64
    req = (
        f"GET {u.path or '/'}{('?' + u.query) if u.query else ''} HTTP/1.1\r\n"
        f"Host: {host}:{port}\r\n"
        "Upgrade: websocket\r\nConnection: Upgrade\r\n"
        f"Sec-WebSocket-Key: {base64.b64encode(key).decode()}\r\n"
        "Sec-WebSocket-Version: 13\r\n\r\n"
    )
    s = socket.create_connection((host, port), 2.0)
    try:
        s.sendall(req.encode())
        s.recv(4096)
        payload = json.dumps({"id": 1, "method": "Page.reload", "params": {"ignoreCache": True}}).encode()
        mask = os.urandom(4)
        body = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
        header = bytes([0x81, 0x80 | len(payload)]) + mask
        s.sendall(header + body)
        s.recv(256)
    finally:
        s.close()

ok = False
for port in ports:
    hits = pick(tabs(port))
    for tab in hits:
        ws = tab.get("webSocketDebuggerUrl")
        if not ws:
            continue
        try:
            reload_ws(ws)
            print(tab.get("url") or ws)
            ok = True
        except Exception as e:
            print(f"cdp {port}: {e}", file=sys.stderr)
if not ok:
    raise SystemExit(1)
PY
  then
    return 0
  fi
  if command -v xdotool >/dev/null 2>&1 && [[ -n "${DISPLAY:-}" ]]; then
    local wid
    wid="$(xdotool search --name 'zoto-viz' 2>/dev/null | tail -n1 || true)"
    if [[ -n "$wid" ]]; then
      xdotool windowactivate --sync "$wid" key --clearmodifiers ctrl+r
      return 0
    fi
  fi
  return 1
}

restart_services() {
  local did=0
  if systemctl --user is-active --quiet "$UNIT" 2>/dev/null; then
    log "restart $UNIT"
    systemctl --user restart "$UNIT"
    did=1
  fi
  if [[ -f "$ROOT/.run/frontend.pid" || -f "$ROOT/.run/backend.pid" ]]; then
    if systemctl --user is-active --quiet "$UNIT" 2>/dev/null; then
      log "restart vite frontend"
      bash "$ROOT/scripts/dev.sh" restart frontend
    else
      log "restart backend + frontend"
      bash "$ROOT/scripts/dev.sh" restart both
    fi
    did=1
  elif [[ $did -eq 0 ]]; then
    log "restart backend + frontend (nothing was marked running)"
    bash "$ROOT/scripts/dev.sh" restart both
    did=1
  fi
  wait_port "$PORT" 40 || log "warn: :$PORT not up after restart"
}

apply_updates() {
  local files="$1"
  if grep -qx 'requirements.txt' <<<"$files"; then
    log "pip install -r requirements.txt"
    "$(py)" -m pip install -r "$ROOT/requirements.txt"
  fi
  if grep -E '^(web/|plugins/src/)' <<<"$files" >/dev/null; then
    log "pnpm --dir web build"
    pnpm --dir "$ROOT/web" build
  fi
}

load_plugin_views() {
  local files="$1"
  wait_port "$PORT" 20 || { log "warn: MCP not up, skip views"; return 0; }
  local ids mosaic tiles args
  mapfile -t ids < <(changed_plugin_ids <<<"$files" | sort)
  log "autoconsent + dice off"
  mcp set_settings '{"autoconsent":true,"dice":{"on":false},"dream":false}' >/dev/null || true
  sleep 1
  if [[ ${#ids[@]} -eq 0 ]]; then
    log "no plugin src changes — catalog refresh only"
    return 0
  fi
  log "plugin views: ${ids[*]}"
  if [[ ${#ids[@]} -eq 1 ]]; then
    mcp set_settings "$(jq -nc --arg m "plugin:${ids[0]}" \
      '{mode:$m,anim:{mosaic:"off"}}')" >/dev/null || true
    mcp set_view "$(jq -nc --arg m "plugin:${ids[0]}" '{mode:$m}')" >/dev/null || true
    return 0
  fi
  mosaic=4
  [[ ${#ids[@]} -ge 4 ]] && mosaic=6
  [[ ${#ids[@]} -ge 6 ]] && mosaic=8
  tiles="$(printf '%s\n' "${ids[@]}" | head -n 8 | jq -R 'select(length>0) | "plugin:" + .' | jq -s -c '.')"
  args="$(jq -nc --argjson tiles "$tiles" --arg mos "$mosaic" --arg first "plugin:${ids[0]}" \
    '{mode:$first,anim:{mosaic:$mos,mosaicTiles:$tiles,mosaicUniqueSkies:false},dice:{on:false}}')"
  mcp set_settings "$args" >/dev/null || true
  mcp set_view "$(jq -nc --arg m "plugin:${ids[0]}" '{mode:$m}')" >/dev/null || true
}

tick() {
  cd "$ROOT"
  if [[ -f .git/MERGE_HEAD ]]; then
    log "skip: merge in progress"
    return 0
  fi
  if [[ -n "$(git status --porcelain)" ]]; then
    log "skip: dirty worktree"
    return 0
  fi
  if ! git rev-parse --abbrev-ref '@{upstream}' >/dev/null 2>&1; then
    log "skip: no upstream"
    return 0
  fi
  local before after files
  before="$(git rev-parse HEAD)"
  if ! git fetch --quiet origin; then
    log "skip: git fetch failed"
    return 0
  fi
  after="$(git rev-parse '@{upstream}')"
  if [[ "$before" == "$after" ]]; then
    log "fresh $before"
    return 0
  fi
  log "pull $before..$after"
  if ! git pull --ff-only --quiet; then
    log "error: git pull --ff-only failed"
    return 1
  fi
  after="$(git rev-parse HEAD)"
  files="$(git diff --name-only "$before" "$after")"
  log "changed $(echo "$files" | grep -c . || true) files"
  apply_updates "$files"
  restart_services
  if reload_chrome; then
    log "reloaded Chrome tab"
  else
    log "warn: no Chrome debug / xdotool tab — open http://127.0.0.1:${PORT}/"
  fi
  sleep 2
  load_plugin_views "$files"
  log "applied $after"
}

need() {
  command -v git >/dev/null || { echo "git required" >&2; exit 1; }
  command -v curl >/dev/null || { echo "curl required" >&2; exit 1; }
  command -v jq >/dev/null || { echo "jq required" >&2; exit 1; }
}

need
if [[ "$ONCE" -eq 1 ]]; then
  tick
  exit $?
fi
log "watching $ROOT every ${INTERVAL}s"
while true; do
  tick || log "tick failed"
  sleep "$INTERVAL"
done
