from __future__ import annotations

from pathlib import Path

import pytest

from service import agent_assets


def test_photo_cap_fits_nasa_originals() -> None:
    assert agent_assets.MAX_BYTES >= 24_000_000
    assert agent_assets.FETCH_S >= 30


def test_check_url_https_public(monkeypatch) -> None:
    monkeypatch.setattr(agent_assets.socket, "getaddrinfo", lambda *a, **k: [
        (0, 0, 0, "", ("1.1.1.1", 0)),
    ])
    assert agent_assets.check_url("https://example.com/pic.jpg").startswith("https://")


def test_check_url_rejects_lan_and_http(monkeypatch) -> None:
    monkeypatch.setattr(agent_assets.socket, "getaddrinfo", lambda *a, **k: [
        (0, 0, 0, "", ("192.168.1.9", 0)),
    ])
    with pytest.raises(ValueError):
        agent_assets.check_url("https://evil.example/x")
    with pytest.raises(ValueError):
        agent_assets.check_url("http://example.com/x")
    with pytest.raises(ValueError):
        agent_assets.check_url("https://localhost/x")


def test_find_by_url_hits_cached_photo(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(agent_assets, "assets_dir", lambda: tmp_path)
    monkeypatch.setattr(agent_assets.socket, "getaddrinfo", lambda *a, **k: [
        (0, 0, 0, "", ("1.1.1.1", 0)),
    ])
    aid = "aabbccddeeff0011"
    (tmp_path / f"{aid}.jpg").write_bytes(b"x" * 40)
    agent_assets._write_meta(aid, {
        "id": aid,
        "kind": "photo",
        "mime": "image/jpeg",
        "href": f"/api/ai/assets/{aid}",
        "url": "https://example.com/a.jpg",
        "src": "https://example.com/a.jpg",
    })
    hit = agent_assets.find_by_url("https://example.com/a.jpg")
    assert hit and hit["id"] == aid
    assert agent_assets.find_by_url("https://example.com/missing.jpg") is None


def test_store_svg_and_list(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(agent_assets, "assets_dir", lambda: tmp_path)
    row = agent_assets.store_svg('<svg xmlns="http://www.w3.org/2000/svg"></svg>')
    assert row["kind"] == "svg"
    assert (tmp_path / f"{row['id']}.svg").is_file()
    assert any(a["id"] == row["id"] for a in agent_assets.list_assets())
    with pytest.raises(ValueError):
        agent_assets.store_svg("<div></div>")
