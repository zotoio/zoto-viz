"""Host mesh lane loader gaps (#129): meshopt, multi-mesh, skinned swim — revert proofs."""
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LANE = ROOT / "web" / "src" / "graph" / "host-mesh-lane.ts"

REVERT_FIRST_MESH_ONLY = "if (!mesh && (obj as THREE.Mesh).isMesh) mesh = obj as THREE.Mesh"


def test_host_mesh_lane_has_meshopt_decoder() -> None:
    text = LANE.read_text(encoding="utf-8")
    assert "setMeshoptDecoder" in text
    assert "MeshoptDecoder" in text


def test_host_mesh_lane_revert_first_mesh_only_would_fail() -> None:
    text = LANE.read_text(encoding="utf-8")
    assert REVERT_FIRST_MESH_ONLY not in text
    assert REVERT_FIRST_MESH_ONLY in text + "\n" + REVERT_FIRST_MESH_ONLY


def test_host_mesh_lane_multi_node_rigid_clone() -> None:
    text = LANE.read_text(encoding="utf-8")
    assert "template.clone(true)" in text
    assert "wheel_front_left" in text or "getObjectByName" in text


def test_host_mesh_lane_skinned_swim_mixer() -> None:
    text = LANE.read_text(encoding="utf-8")
    assert "AnimationMixer" in text
    assert "swim" in text
    assert "animOffset" in text


def test_realism_packs_ship_glb_assets() -> None:
    for pid in ("rocket-car-soccer", "koi-pond", "aquarium"):
        yml = (ROOT / "plugins" / "src" / pid / "plugin.yml").read_text(encoding="utf-8")
        assert "assets:" in yml
        assert "path: assets/" in yml
        assert (ROOT / "plugins" / "src" / pid / "assets").is_dir()
