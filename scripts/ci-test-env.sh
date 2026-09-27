#!/usr/bin/env bash
# Review-parity test environment: uv 3.12 venv, shim PATH, pnpm deps.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SHIM="$ROOT/.ci-shim/bin"
mkdir -p "$SHIM"
if [[ ! -x "$SHIM/systemd-inhibit" ]]; then
  printf '%s\n' '#!/usr/bin/env bash' 'exec "$@"' > "$SHIM/systemd-inhibit"
  chmod +x "$SHIM/systemd-inhibit"
fi
export PATH="$SHIM:$PATH"
if command -v uv >/dev/null 2>&1; then
  uv venv --python 3.12 "$ROOT/.venv-review" 2>/dev/null || true
  uv pip install --python "$ROOT/.venv-review/bin/python" pip aiohttp -r "$ROOT/requirements.txt"
else
  python3.12 -m venv "$ROOT/.venv-review"
  "$ROOT/.venv-review/bin/pip" install -U pip aiohttp -r "$ROOT/requirements.txt"
fi
export PATH="$ROOT/.venv-review/bin:$PATH"
( cd "$ROOT/web" && pnpm install --frozen-lockfile 2>/dev/null || pnpm install )
( cd "$ROOT/service/cursor-bridge" && pnpm install --frozen-lockfile 2>/dev/null || pnpm install )
( cd "$ROOT/docs" && pnpm install --frozen-lockfile 2>/dev/null || pnpm install )
echo "env ready: $(python --version) node=$(node --version)"
