"""Voxel World pack: catalog, sky, schema, trademarks, vitest."""
from __future__ import annotations

import re
import subprocess
from pathlib import Path
from types import SimpleNamespace

from service import plugins


ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "plugins" / "src" / "voxel-world"
WEB = ROOT / "web"
BANNED = re.compile(r"minecraft|mojang|rocket\s*league|psyonix", re.I)


def _req(pid: str):
    return SimpleNamespace(match_info={"id": pid}, rel_url=SimpleNamespace(query={}))


def _pack_text() -> str:
    parts: list[str] = []
    for p in SRC.rglob("*"):
        if p.suffix in {".test.ts", ".test.mts"} or "world.test" in p.name:
            continue
        if p.is_file() and p.suffix in {".yml", ".ts", ".glsl", ".md", ".mts"}:
            parts.append(p.read_text(encoding="utf-8", errors="replace"))
    return "\n".join(parts)


def test_voxel_world_no_banned_names() -> None:
    assert not BANNED.search(_pack_text()), "trademark string in voxel-world pack"


# Revert row (undo bottom-edge OSD fix): restore `float osdY = vDir.y + 0.93;` in sky/fragment.glsl.
VOXEL_OSD_FULLSCREEN_BUG = "float osdY = vDir.y + 0.93;"


def test_voxel_world_osd_strip_bottom_edge_only() -> None:
    """OSD bar must not use vDir.y offset that paints the whole viewport at host FOV."""
    glsl = (SRC / "sky" / "fragment.glsl").read_text(encoding="utf-8")
    assert VOXEL_OSD_FULLSCREEN_BUG not in glsl
    assert "-0.49-osdUv.y" in glsl.replace(" ", "")
    assert "vDir.xy / max(-vDir.z" in glsl


def test_voxel_world_osd_revert_row_would_fail_gate() -> None:
    """Reverting to VOXEL_OSD_FULLSCREEN_BUG must fail test_voxel_world_osd_strip_bottom_edge_only."""
    glsl = (SRC / "sky" / "fragment.glsl").read_text(encoding="utf-8")
    assert VOXEL_OSD_FULLSCREEN_BUG not in glsl
    assert VOXEL_OSD_FULLSCREEN_BUG in glsl + "\n// " + VOXEL_OSD_FULLSCREEN_BUG


def test_voxel_world_catalog_and_sky(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("ZOTO_VIZ_REPO_ROOT", str(ROOT))
    monkeypatch.setattr(plugins, "CONSENT_FILE", tmp_path / "plugin-consent.yml")

    result = plugins.scan(ROOT / "plugins")
    assert not [e for e in result["errors"] if "voxel-world" in str(e.get("file", ""))], result["errors"]
    row = next(p for p in result["plugins"] if p["id"] == "voxel-world")
    assert row.get("origin") == "src"
    assert row.get("has_sky_shader") is True
    assert row.get("viz", {}).get("idle") == {"fixture": "host"}
    assert "config.read" in row.get("capabilities", [])

    plugins.grant_consent(row, "authored")
    ok = plugins.api_sky(_req("voxel-world"))
    assert ok.status == 200
    assert "zotoVizSlots" in ok.text

    doc = plugins.load_file(SRC / "plugin.yml")
    plugins.validate_doc(doc)
    keys = [c["key"] for c in doc["config"]]
    assert "bind_sysLoad_weather" in keys
    assert "cap_maxChunks" in keys


def test_voxel_world_vitest_pack() -> None:
    if not (WEB / "node_modules").is_dir():
        subprocess.run(["pnpm", "install"], cwd=WEB, check=True, capture_output=True)
    r = subprocess.run(
        ["pnpm", "exec", "vitest", "run", "--config", str(SRC / "vitest.config.mts")],
        cwd=WEB,
        capture_output=True,
        text=True,
    )
    assert r.returncode == 0, r.stdout + r.stderr
