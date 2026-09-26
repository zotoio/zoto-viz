"""Pack asset route: path containment, consent, cache headers."""
from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

from service import plugins


def _req(pid: str, rel: str) -> SimpleNamespace:
    return SimpleNamespace(
        match_info={"id": pid, "path": rel},
        rel_url=SimpleNamespace(query={}),
    )


def test_src_plugin_asset_served_with_immutable_cache(tmp_path: Path, monkeypatch) -> None:
    home = tmp_path / "demo-pack"
    home.mkdir()
    (home / "plugin.yml").write_text("id: demo-pack\nname: Demo\nversion: 1\n", encoding="utf-8")
    asset = home / "sfx" / "tone.mp3"
    asset.parent.mkdir(parents=True)
    asset.write_bytes(b"\xff\xfb")
    row = {
        "id": "demo-pack",
        "file": str(home / "plugin.yml"),
        "origin": "src",
        "sha256": "abc123",
    }
    monkeypatch.setattr(plugins, "_plugin_row", lambda pid: row if pid == "demo-pack" else None)
    resp = plugins.api_asset(_req("demo-pack", "sfx/tone.mp3"))
    assert resp.status == 200
    assert resp.headers.get("Cache-Control") == "public, max-age=31536000, immutable"
    assert resp.headers.get("ETag") == '"abc123"'


def test_zip_plugin_asset_requires_consent(tmp_path: Path, monkeypatch) -> None:
    home = tmp_path / "demo-pack"
    home.mkdir()
    (home / "plugin.yml").write_text("id: demo-pack\nname: Demo\nversion: 1\n", encoding="utf-8")
    (home / "sfx" / "tone.mp3").parent.mkdir(parents=True)
    (home / "sfx" / "tone.mp3").write_bytes(b"x")
    row = {
        "id": "demo-pack",
        "file": str(home / "plugin.yml"),
        "origin": "zip",
        "consent": None,
        "has_sky_shader": True,
        "capabilities": ["viz.write"],
    }
    monkeypatch.setattr(plugins, "_plugin_row", lambda pid: row if pid == "demo-pack" else None)
    resp = plugins.api_asset(_req("demo-pack", "sfx/tone.mp3"))
    assert resp.status == 403


def test_asset_rejects_traversal(tmp_path: Path, monkeypatch) -> None:
    home = tmp_path / "demo-pack"
    home.mkdir()
    row = {"id": "demo-pack", "file": str(home / "plugin.yml"), "origin": "src"}
    monkeypatch.setattr(plugins, "_plugin_row", lambda pid: row if pid == "demo-pack" else None)
    resp = plugins.api_asset(_req("demo-pack", "../../service/monitor.py"))
    assert resp.status in (400, 404)
