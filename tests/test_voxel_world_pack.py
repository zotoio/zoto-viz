"""Shipped Voxel World pack: catalog row, idle fixture, consented sky."""
from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

from service import plugins


ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "plugins" / "src" / "voxel-world"


def _req(pid: str):
    return SimpleNamespace(match_info={"id": pid}, rel_url=SimpleNamespace(query={}))


def test_voxel_world_catalog_and_sky(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("ZOTO_VIZ_REPO_ROOT", str(ROOT))
    monkeypatch.setattr(plugins, "CONSENT_FILE", tmp_path / "plugin-consent.yml")

    result = plugins.scan(ROOT / "plugins")
    assert not [e for e in result["errors"] if "voxel-world" in str(e.get("file", ""))], result["errors"]
    row = next(p for p in result["plugins"] if p["id"] == "voxel-world")
    assert row.get("origin") == "src"
    assert row.get("has_sky_shader") is True
    assert (SRC / "sky" / "fragment.glsl").is_file()
    assert row.get("viz", {}).get("idle") == {"fixture": "host"}
    assert row.get("viz", {}).get("maxBuffers") == 2
    assert row.get("viz", {}).get("maxBufferFloats") == 64
    assert "config.read" in row.get("capabilities", [])

    plugins.grant_consent(row, "authored")
    fresh = plugins.scan(ROOT / "plugins")["plugins"]
    vox = next(p for p in fresh if p["id"] == "voxel-world")
    assert vox["sky_available"] is True
    assert "sky_error" not in vox or not vox.get("sky_error")

    ok = plugins.api_sky(_req("voxel-world"))
    assert ok.status == 200
    assert "zotoVizSlots" in ok.text
    assert "traceVoxel" in ok.text
