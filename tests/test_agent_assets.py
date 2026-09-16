from __future__ import annotations

from pathlib import Path

import pytest

from service import agent_assets


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


def test_store_svg_and_list(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(agent_assets, "assets_dir", lambda: tmp_path)
    row = agent_assets.store_svg('<svg xmlns="http://www.w3.org/2000/svg"></svg>')
    assert row["kind"] == "svg"
    assert (tmp_path / f"{row['id']}.svg").is_file()
    assert any(a["id"] == row["id"] for a in agent_assets.list_assets())
    with pytest.raises(ValueError):
        agent_assets.store_svg("<div></div>")
