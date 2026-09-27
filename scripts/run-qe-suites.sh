#!/usr/bin/env bash
# QE gate (1): run pytest/vitest with repo .venv first on PATH (PyYAML for viz-pack-runtime-esbuild).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="$ROOT/.venv/bin:${PATH}"
cd "$ROOT/web" && pnpm exec vitest run
cd "$ROOT" && pytest -q
