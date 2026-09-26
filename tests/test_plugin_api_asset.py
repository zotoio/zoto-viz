"""Pack asset route: assets/ containment, consent, cache headers."""
from __future__ import annotations

import os
from pathlib import Path
from types import SimpleNamespace

from service import plugins


def _req(pid: str, rel: str, query: dict[str, str] | None = None) -> SimpleNamespace:
    return SimpleNamespace(
        match_info={"id": pid, "path": rel},
        rel_url=SimpleNamespace(query=query or {}),
    )


def _pack_home(tmp_path: Path) -> Path:
    home = tmp_path / "demo-pack"
    home.mkdir()
    (home / "plugin.yml").write_text(
        "id: demo-pack\nname: Demo\nversion: 1\ncapabilities: [viz.write]\n",
        encoding="utf-8",
    )
    assets = home / "assets"
    assets.mkdir()
    return home


def test_src_asset_immutable_cache_when_hash_query_matches(tmp_path: Path, monkeypatch) -> None:
    home = _pack_home(tmp_path)
    tone = home / "assets" / "tone.mp3"
    tone.write_bytes(b"\xff\xfb")
    row = {
        "id": "demo-pack",
        "file": str(home / "plugin.yml"),
        "origin": "src",
        "sha256": "abc123",
    }
    monkeypatch.setattr(plugins, "_plugin_row", lambda pid: row if pid == "demo-pack" else None)
    resp = plugins.api_asset(_req("demo-pack", "tone.mp3", {"h": "abc123"}))
    assert resp.status == 200
    assert resp.headers.get("Cache-Control") == "private, max-age=31536000, immutable"
    assert resp.headers.get("X-Content-Type-Options") == "nosniff"
    assert resp.content_type == "audio/mpeg"


def test_asset_private_no_cache_without_matching_digest(tmp_path: Path, monkeypatch) -> None:
    home = _pack_home(tmp_path)
    (home / "assets" / "tone.mp3").write_bytes(b"x")
    row = {"id": "demo-pack", "file": str(home / "plugin.yml"), "origin": "src", "sha256": "abc123"}
    monkeypatch.setattr(plugins, "_plugin_row", lambda pid: row if pid == "demo-pack" else None)
    resp = plugins.api_asset(_req("demo-pack", "tone.mp3"))
    assert resp.status == 200
    assert resp.headers.get("Cache-Control") == "private, no-cache"
    assert resp.headers.get("ETag")


def test_zip_asset_requires_stored_consent(tmp_path: Path, monkeypatch) -> None:
    home = _pack_home(tmp_path)
    (home / "assets" / "tone.mp3").write_bytes(b"x")
    row = {
        "id": "demo-pack",
        "file": str(home / "plugin.yml"),
        "origin": "zip",
        "consent": None,
        "capabilities": ["viz.write"],
        "has_sky_shader": True,
    }
    monkeypatch.setattr(plugins, "_plugin_row", lambda pid: row if pid == "demo-pack" else None)
    resp = plugins.api_asset(_req("demo-pack", "tone.mp3"))
    assert resp.status == 403


def test_traversal_rejected_with_plugin_yml(tmp_path: Path, monkeypatch) -> None:
    home = _pack_home(tmp_path)
    (home / "assets" / "ok.mp3").write_bytes(b"x")
    row = {"id": "demo-pack", "file": str(home / "plugin.yml"), "origin": "src"}
    monkeypatch.setattr(plugins, "_plugin_row", lambda pid: row if pid == "demo-pack" else None)
    resp = plugins.api_asset(_req("demo-pack", "../plugin.yml"))
    assert resp.status == 400


def test_traversal_absolute_path(tmp_path: Path, monkeypatch) -> None:
    home = _pack_home(tmp_path)
    row = {"id": "demo-pack", "file": str(home / "plugin.yml"), "origin": "src"}
    monkeypatch.setattr(plugins, "_plugin_row", lambda pid: row if pid == "demo-pack" else None)
    resp = plugins.api_asset(_req("demo-pack", "/etc/passwd"))
    assert resp.status == 400


def test_traversal_encoded_dotdot(tmp_path: Path, monkeypatch) -> None:
    home = _pack_home(tmp_path)
    row = {"id": "demo-pack", "file": str(home / "plugin.yml"), "origin": "src"}
    monkeypatch.setattr(plugins, "_plugin_row", lambda pid: row if pid == "demo-pack" else None)
    resp = plugins.api_asset(_req("demo-pack", "%2e%2e/plugin.yml"))
    assert resp.status == 400


def test_dotfile_rejected(tmp_path: Path, monkeypatch) -> None:
    home = _pack_home(tmp_path)
    (home / "assets" / ".hidden.mp3").write_bytes(b"x")
    row = {"id": "demo-pack", "file": str(home / "plugin.yml"), "origin": "src"}
    monkeypatch.setattr(plugins, "_plugin_row", lambda pid: row if pid == "demo-pack" else None)
    resp = plugins.api_asset(_req("demo-pack", ".hidden.mp3"))
    assert resp.status == 400


def test_directory_not_served(tmp_path: Path, monkeypatch) -> None:
    home = _pack_home(tmp_path)
    (home / "assets" / "nested").mkdir()
    row = {"id": "demo-pack", "file": str(home / "plugin.yml"), "origin": "src"}
    monkeypatch.setattr(plugins, "_plugin_row", lambda pid: row if pid == "demo-pack" else None)
    resp = plugins.api_asset(_req("demo-pack", "nested"))
    assert resp.status == 400


def test_disallowed_suffix(tmp_path: Path, monkeypatch) -> None:
    home = _pack_home(tmp_path)
    (home / "assets" / "run.exe").write_bytes(b"x")
    row = {"id": "demo-pack", "file": str(home / "plugin.yml"), "origin": "src"}
    monkeypatch.setattr(plugins, "_plugin_row", lambda pid: row if pid == "demo-pack" else None)
    resp = plugins.api_asset(_req("demo-pack", "run.exe"))
    assert resp.status == 400


def test_mime_jpeg_wav_ogg(tmp_path: Path, monkeypatch) -> None:
    home = _pack_home(tmp_path)
    (home / "assets" / "a.jpg").write_bytes(b"x")
    (home / "assets" / "b.wav").write_bytes(b"x")
    (home / "assets" / "c.ogg").write_bytes(b"x")
    row = {"id": "demo-pack", "file": str(home / "plugin.yml"), "origin": "src"}
    monkeypatch.setattr(plugins, "_plugin_row", lambda pid: row if pid == "demo-pack" else None)
    assert plugins.api_asset(_req("demo-pack", "a.jpg")).content_type == "image/jpeg"
    assert plugins.api_asset(_req("demo-pack", "b.wav")).content_type == "audio/wav"
    assert plugins.api_asset(_req("demo-pack", "c.ogg")).content_type == "audio/ogg"


def test_symlink_escape_rejected(tmp_path: Path, monkeypatch) -> None:
    home = _pack_home(tmp_path)
    outside = tmp_path / "outside.mp3"
    outside.write_bytes(b"x")
    link = home / "assets" / "evil.mp3"
    try:
        link.symlink_to(outside)
    except OSError:
        return
    row = {"id": "demo-pack", "file": str(home / "plugin.yml"), "origin": "src"}
    monkeypatch.setattr(plugins, "_plugin_row", lambda pid: row if pid == "demo-pack" else None)
    resp = plugins.api_asset(_req("demo-pack", "evil.mp3"))
    assert resp.status in (400, 404)


def test_present_tick_requires_viz_write() -> None:
    doc = {
        "id": "x",
        "name": "X",
        "version": 1,
        "capabilities": ["viz.read"],
        "viz": {"graphWalk": False, "presentTick": True, "idle": {"fixture": "host"}},
    }
    try:
        plugins.validate_doc(doc)
        assert False, "expected validation error"
    except ValueError as e:
        assert "presentTick" in str(e)
