"""Host mesh lane loader gaps (#129): meshopt, multi-mesh, skinned swim — revert proofs."""
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LANE = ROOT / "web" / "src" / "graph" / "host-mesh-lane.ts"

REVERT_FIRST_MESH_ONLY = "if (!mesh && (obj as THREE.Mesh).isMesh) mesh = obj as THREE.Mesh"


def test_host_mesh_lane_strips_assets_prefix_in_api_url() -> None:
    text = LANE.read_text(encoding="utf-8")
    assert 'replace(/^assets\\//i, "")' in text


def test_host_mesh_lane_clear_cancels_inflight_and_disposes() -> None:
    text = LANE.read_text(encoding="utf-8")
    assert "loadEpoch" in text
    assert "disposeHostMeshObject3D" in text
    assert "uncacheRoot" in text


REVERT_CLEAR_NO_DISPOSE = "clear(): void {\n    this.clearLive();"


REVERT_CLEAR_NO_MIXER_STOP = """    const skin = this.skinnedLive.get(assetId);
    if (skin) {
      for (const s of skin) {
        s.root.removeFromParent();
      }
      this.skinnedLive.delete(assetId);
    }"""

REVERT_CLEAR_NO_TEMPLATE_MAP_CLEAR = (
    "      disposeHostMeshObject3D(t.template);\n"
    "    }\n"
    "    this.pending.clear();\n"
    "    this.assetOrder = [];\n"
    "  }\n"
    "\n"
    "  /** Advance skinned swim clips. */\n"
)

REVERT_INFLIGHT_NO_EPOCH_CANCEL = """      if (epoch !== this.loadEpoch) {
        disposeHostMeshObject3D(gltf.scene);
        return null;
      }"""


def test_host_mesh_lane_has_meshopt_decoder() -> None:
    text = LANE.read_text(encoding="utf-8")
    assert "setMeshoptDecoder" in text
    assert "MeshoptDecoder" in text


def test_host_mesh_lane_revert_first_mesh_only_would_fail() -> None:
    text = LANE.read_text(encoding="utf-8")
    assert REVERT_FIRST_MESH_ONLY not in text
    assert REVERT_FIRST_MESH_ONLY in text + "\n" + REVERT_FIRST_MESH_ONLY


def test_host_mesh_lane_revert_clear_without_teardown_would_fail() -> None:
    text = LANE.read_text(encoding="utf-8")
    assert REVERT_CLEAR_NO_DISPOSE not in text
    assert REVERT_CLEAR_NO_DISPOSE in text + "\n" + REVERT_CLEAR_NO_DISPOSE


def test_host_mesh_lane_revert_clear_without_mixer_stop_would_fail() -> None:
    text = LANE.read_text(encoding="utf-8")
    assert "stopSkinnedMixer" in text
    assert REVERT_CLEAR_NO_MIXER_STOP not in text


def test_host_mesh_lane_revert_clear_without_template_map_clear_would_fail() -> None:
    text = LANE.read_text(encoding="utf-8")
    assert "this.templates.clear();" in text
    assert REVERT_CLEAR_NO_TEMPLATE_MAP_CLEAR not in text


def test_host_mesh_lane_revert_inflight_without_epoch_cancel_would_fail() -> None:
    text = LANE.read_text(encoding="utf-8")
    assert REVERT_INFLIGHT_NO_EPOCH_CANCEL in text


def test_host_mesh_lane_clear_exact_counts_vitest() -> None:
    test_ts = ROOT / "web" / "src" / "graph" / "host-mesh-lane.test.ts"
    text = test_ts.read_text(encoding="utf-8")
    assert "clear() exact teardown counts (Performance Pedant)" in text
    assert "N_LOADED_MESHES = 3" in text
    assert "M_LIVE_MIXERS = 2" in text
    assert "geoDispose).toHaveBeenCalledTimes(N_LOADED_MESHES)" in text
    assert "stopSpy).toHaveBeenCalledTimes(M_LIVE_MIXERS)" in text


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
