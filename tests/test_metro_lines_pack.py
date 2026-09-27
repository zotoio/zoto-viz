"""Shipped Metro Lines pack: pack-local vitest."""
from __future__ import annotations

import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "plugins" / "src" / "metro-lines"
PACK_TEST = SRC / "frontend" / "index.test.ts"


def test_metro_lines_pack_vitest() -> None:
    assert PACK_TEST.is_file()
    web = ROOT / "web"
    proc = subprocess.run(
        [
            "pnpm",
            "exec",
            "vitest",
            "run",
            "--config",
            "../plugins/src/metro-lines/vitest.config.cjs",
        ],
        cwd=web,
        capture_output=True,
        text=True,
        check=False,
    )
    assert proc.returncode == 0, proc.stdout + proc.stderr
