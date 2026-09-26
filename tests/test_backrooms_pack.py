"""Shipped Backrooms pack: catalog row, idle fixture, consented sky."""
from __future__ import annotations

import subprocess
from pathlib import Path
from types import SimpleNamespace

import yaml

from service import plugins


ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "plugins" / "src" / "backrooms"


def _req(pid: str):
    return SimpleNamespace(match_info={"id": pid}, rel_url=SimpleNamespace(query={}))


def test_backrooms_catalog_and_sky(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("ZOTO_VIZ_REPO_ROOT", str(ROOT))
    monkeypatch.setattr(plugins, "CONSENT_FILE", tmp_path / "plugin-consent.yml")

    result = plugins.scan(ROOT / "plugins")
    assert not [e for e in result["errors"] if "backrooms" in str(e.get("file", ""))], result["errors"]
    row = next(p for p in result["plugins"] if p["id"] == "backrooms")
    assert row.get("origin") == "src"
    assert row["has_sky_shader"] is True
    assert (SRC / "sky" / "fragment.glsl").is_file()
    idle = row.get("viz", {}).get("idle")
    assert isinstance(idle, dict) and idle.get("packets") and idle.get("talkers")
    assert row.get("viz", {}).get("presentTick") is True

    plugins.grant_consent(row, "authored")
    fresh = plugins.scan(ROOT / "plugins")["plugins"]
    bro = next(p for p in fresh if p["id"] == "backrooms")
    assert bro["sky_available"] is True
    assert "sky_error" not in bro or not bro.get("sky_error")

    ok = plugins.api_sky(_req("backrooms"))
    assert ok.status == 200
    assert "zotoVizSlots" in ok.text
    assert "bool walled(" in ok.text
    assert row.get("viz", {}).get("maxBuffers") == 2
    for name in ("buzz.mp3", "roar.mp3", "pant.mp3"):
        assert (SRC / "assets" / "sfx" / name).is_file(), name
    assert (SRC / "audio.manifest.yml").is_file()


def test_backrooms_present_pack_vitest() -> None:
    web = ROOT / "web"
    subprocess.run(
        ["pnpm", "exec", "vitest", "run", "../plugins/src/backrooms"],
        cwd=web,
        check=True,
    )


def test_backrooms_audio_manifest_matches_yaml() -> None:
    yml = yaml.safe_load((SRC / "audio.manifest.yml").read_text(encoding="utf-8"))
    ts = (SRC / "frontend" / "audio-manifest.ts").read_text(encoding="utf-8")
    for rel in yml["required"]:
        assert rel in ts
    for key, rel in {**yml["loops"], **yml["one_shots"]}.items():
        assert f"{key}" in ts and rel in ts
