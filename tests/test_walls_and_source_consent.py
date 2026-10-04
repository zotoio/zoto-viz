"""Named walls and per-host source consent."""
from __future__ import annotations

import asyncio
from pathlib import Path

from service import source_consent, sources, walls
from service.pack_block_copy import GRAPHICS_CODE_ERROR, BLOCK_AUTHOR_TAIL, PackBlockedError
from service.plugin_install import upgrade_failure_from_check


def test_walls_round_trip_and_delete_names_the_wall(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("ZOTO_VIZ_WALLS", str(tmp_path / "walls.yml"))
    doc = walls.migrate_current({"mosaic": "16"}, {"partCap": 8}, {"t": {"sky": "grid"}})
    assert doc["walls"]["default"]["name"] == "Default"
    assert doc["walls"]["default"]["layout"]["mosaic"] == "16"
    saved = walls.save_as("Night")
    assert saved["walls"][saved["active"]]["name"] == "Night"
    assert saved["walls"][saved["active"]]["layout"]["mosaic"] == "16"
    renamed = walls.rename(saved["active"], "Dawn")
    assert renamed["walls"][saved["active"]]["name"] == "Dawn"
    again = walls._read()
    assert again["walls"][saved["active"]]["layout"]["mosaic"] == "16"
    left = walls.delete(saved["active"])
    assert saved["active"] not in left["walls"]
    assert left["active"] == "default"


def test_ungranted_host_does_not_fetch(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("ZOTO_VIZ_SOURCE_CONSENT", str(tmp_path / "source-consent.yml"))
    source_consent._write({"seeded": True, "hosts": []})
    calls = []

    async def boom(_url):
        calls.append(_url)
        raise AssertionError("fetch")

    monkeypatch.setattr(sources, "_http_body", boom)
    row = {"id": "hn", "type": "rss", "url": "https://news.ycombinator.com/rss", "label": "HN", "enabled": True}
    live = asyncio.run(sources.fetch_one(row))
    assert calls == []
    assert live.get("demo") is True or live.get("needsConsent") == "news.ycombinator.com"
    source_consent.allow("news.ycombinator.com")
    assert source_consent.allowed("news.ycombinator.com")
    source_consent.remove("news.ycombinator.com")
    assert source_consent.allowed("news.ycombinator.com") is False


def test_graphics_block_keeps_author_wording_and_a_failed_check_is_not_a_block():
    message, code = upgrade_failure_from_check(
        PackBlockedError("Koi", "its graphics code has an error that would stop it drawing.", tail=BLOCK_AUTHOR_TAIL, reason=GRAPHICS_CODE_ERROR),
        "Koi",
        2,
    )
    assert code == "pack_blocked"
    assert "Ask its author for a fixed version." in message
    assert "run pack lint" not in message
    failed, failed_code = upgrade_failure_from_check(ValueError("esbuild failed"), "Koi", 2)
    assert failed_code == "pack_check_failed"
    assert "blocked" not in failed.lower()
    assert "pack lint" not in failed.lower()
