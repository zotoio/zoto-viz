"""Realism pass: schema, caps, model slot, teardown, smoke vitest hooks for three packs."""
from __future__ import annotations

import json
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


def test_realism_packs_use_host_mesh_slot_three() -> None:
    for pid in PACKS:
        yml = (PACKS[pid] / "plugin.yml").read_text(encoding="utf-8")
        assert "hostMeshSlot: 3" in yml, pid
        assert "maxBuffers: 8" in yml, pid


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


# Every plugins/sdk test file this CI row must run (plugins/sdk/vitest.config.cjs is not part of web's
# `pnpm test`, so a file that drops out of that config's include would otherwise go silent).
SDK_VITEST_FILES = {"host-mesh-frame.test.ts", "pack-host-mesh.test.ts", "pack-model-slot.test.ts", "talker-slots.test.ts"}


def test_realism_sdk_model_slot_vitest(tmp_path: Path) -> None:
    if not (WEB / "node_modules").is_dir():
        subprocess.run(["pnpm", "install"], cwd=WEB, check=True, capture_output=True)
    proc = subprocess.run(
        ["pnpm", "exec", "vitest", "run", "--config", str(ROOT / "plugins" / "sdk" / "vitest.config.cjs"),
         "--reporter=default", "--reporter=json", f"--outputFile.json={tmp_path / 'sdk-vitest.json'}"],
        cwd=WEB,
        capture_output=True,
        text=True,
    )
    assert proc.returncode == 0, proc.stdout + proc.stderr
    report = json.loads((tmp_path / "sdk-vitest.json").read_text())
    passed = {Path(r["name"]).name: sum(a["status"] == "passed" for a in r["assertionResults"]) for r in report["testResults"]}
    assert {f for f in SDK_VITEST_FILES if passed.get(f, 0) == 0} == set(), passed
