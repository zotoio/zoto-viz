"""Realism pass: schema, caps, model slot, teardown, smoke vitest hooks for three packs."""
from __future__ import annotations

import subprocess
from pathlib import Path

import pytest

from service import plugins

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "web"
PACKS = {
    "rocket-car-soccer": ROOT / "plugins" / "src" / "rocket-car-soccer",
    "koi-pond": ROOT / "plugins" / "src" / "koi-pond",
    "aquarium": ROOT / "plugins" / "src" / "aquarium",
}


@pytest.mark.parametrize("pid", list(PACKS))
def test_realism_pack_manifest_validates(pid: str) -> None:
    home = PACKS[pid]
    plugins.validate_plugin_home(home)
    viz = plugins._visualisation_doc(home)
    assert viz is not None
    keys = [c["key"] for c in viz.get("config", [])]
    assert "modelGlb" in keys, f"{pid}: missing modelGlb config slot"


def test_realism_rcs_caps_and_camera_default() -> None:
    pack = (PACKS["rocket-car-soccer"] / "frontend" / "pack.ts").read_text(encoding="utf-8")
    assert "maxCars: 8" in pack
    assert "maxParticles: 96" in pack
    assert 'camera: "ballcam"' in pack
    assert "modelFlags: 33" in pack


def test_realism_koi_aquarium_model_slot_indices() -> None:
    koi = (PACKS["koi-pond"] / "frontend" / "koi-pond.ts").read_text(encoding="utf-8")
    aqu = (PACKS["aquarium"] / "frontend" / "aquarium.ts").read_text(encoding="utf-8")
    assert "modelFlags: 52" in koi
    assert "MAX_PARTICLES = 36" in koi
    assert "modelFlags: 60" in aqu
    assert "MAX_PARTICLES = 24" in aqu


# Revert row: remove damped ball camera (restore fixed broadcast angles only).
RCS_FIXED_BALLCAM_BUG = "const h = st.cars[0]!;\n    yaw = h.yaw + Math.PI;"


def test_realism_rcs_no_car0_ballcam_stuck_framing() -> None:
    match = (PACKS["rocket-car-soccer"] / "frontend" / "match.ts").read_text(encoding="utf-8")
    assert "dampScalar" in match
    assert "cameraTargetFromState" in match
    assert RCS_FIXED_BALLCAM_BUG not in match


def test_realism_rcs_ballcam_revert_row_would_fail_gate() -> None:
    match = (PACKS["rocket-car-soccer"] / "frontend" / "match.ts").read_text(encoding="utf-8")
    assert RCS_FIXED_BALLCAM_BUG not in match
    assert RCS_FIXED_BALLCAM_BUG in match + "\n" + RCS_FIXED_BALLCAM_BUG


@pytest.mark.parametrize("pid,config", [
    ("rocket-car-soccer", "vitest.config.cjs"),
    ("koi-pond", "vitest.config.cjs"),
    ("aquarium", "vitest.config.cjs"),
])
def test_realism_pack_vitest_smoke(pid: str, config: str) -> None:
    src = PACKS[pid]
    if not (WEB / "node_modules").is_dir():
        subprocess.run(["pnpm", "install"], cwd=WEB, check=True, capture_output=True)
    proc = subprocess.run(
        ["pnpm", "exec", "vitest", "run", "--config", str(src / config)],
        cwd=WEB,
        capture_output=True,
        text=True,
    )
    assert proc.returncode == 0, proc.stdout + proc.stderr


def test_realism_sdk_model_slot_vitest() -> None:
    if not (WEB / "node_modules").is_dir():
        subprocess.run(["pnpm", "install"], cwd=WEB, check=True, capture_output=True)
    proc = subprocess.run(
        ["pnpm", "exec", "vitest", "run", "--config", str(ROOT / "plugins" / "sdk" / "vitest.config.cjs")],
        cwd=WEB,
        capture_output=True,
        text=True,
    )
    assert proc.returncode == 0, proc.stdout + proc.stderr
