"""Shipped Marble Run pack: pack-local vitest."""
from __future__ import annotations

import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "plugins" / "src" / "marble-run"
PACK_TEST = SRC / "frontend" / "marble-run.test.ts"


def _ensure_web_vitest() -> None:
    web = ROOT / "web"
    vitest_bin = web / "node_modules" / ".bin" / "vitest"
    if vitest_bin.is_file():
        return
    proc = subprocess.run(
        ["pnpm", "install", "--frozen-lockfile"],
        cwd=web,
        capture_output=True,
        text=True,
        check=False,
    )
    assert proc.returncode == 0, proc.stdout + proc.stderr


def _pack_vitest_filter(pattern: str) -> None:
    _ensure_web_vitest()
    web = ROOT / "web"
    config = SRC / "vitest.config.cjs"
    proc = subprocess.run(
        [
            "pnpm",
            "exec",
            "vitest",
            "run",
            "--config",
            str(config),
            "-t",
            pattern,
        ],
        cwd=web,
        capture_output=True,
        text=True,
        check=False,
    )
    assert proc.returncode == 0, proc.stdout + proc.stderr


def test_marble_run_pack_vitest() -> None:
    assert PACK_TEST.is_file()
    _ensure_web_vitest()
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


def test_marble_run_row_yaml_and_sky() -> None:
    _pack_vitest_filter("declares mapping, work budget in yaml")


def test_marble_run_row_determinism() -> None:
    _pack_vitest_filter("is deterministic for pinned seed")


def test_marble_run_row_integrate_steps() -> None:
    _pack_vitest_filter("600-frame row")


def test_marble_run_row_packet_cap() -> None:
    _pack_vitest_filter("caps live packets at maxPacketsPerFrame")


def test_marble_run_row_demo_not_blank() -> None:
    _pack_vitest_filter("demo frames never leave the board blank")


def test_marble_run_row_work_budget_presets() -> None:
    _pack_vitest_filter("keeps work counts under caps")


def test_marble_run_row_live_and_fail_glow() -> None:
    _pack_vitest_filter("live packets spawn visible marbles")


def test_marble_run_row_jar_and_hue() -> None:
    _pack_vitest_filter("stable jar routing and protocol hue")


def test_marble_run_row_fixed_timestep() -> None:
    _pack_vitest_filter("fixed timestep sim respects catch-up cap")


def test_marble_run_row_slot_geometry() -> None:
    _pack_vitest_filter("packs slot geometry contract")
