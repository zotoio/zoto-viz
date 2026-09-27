"""Shipped Marble Run pack: pack-local vitest."""
from __future__ import annotations

import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "plugins" / "src" / "marble-run"
PACK_TEST = SRC / "frontend" / "marble-run.test.ts"


def test_marble_run_pack_vitest() -> None:
    assert PACK_TEST.is_file()
    web = ROOT / "web"
    config = SRC / "vitest.config.cjs"
    proc = subprocess.run(
        ["pnpm", "exec", "vitest", "run", "--config", str(config)],
        cwd=web,
        capture_output=True,
        text=True,
        check=False,
    )
    assert proc.returncode == 0, proc.stdout + proc.stderr
