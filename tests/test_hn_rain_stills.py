from __future__ import annotations

import asyncio
from pathlib import Path
from unittest.mock import patch

import pytest
from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer

from service import hn_rain_stills


def test_extract_svg_from_composer_fences() -> None:
    raw = 'Sure.\n```svg\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><rect width="8" height="8"/></svg>\n```'
    svg = hn_rain_stills.extract_svg(raw)
    assert svg and svg.startswith("<svg")
    assert hn_rain_stills.extract_svg("no drawing") is None


def test_title_key_is_stable() -> None:
    assert hn_rain_stills.title_key("Jemalloc") == hn_rain_stills.title_key("  JEMALLOC ")
    assert hn_rain_stills.title_key("Jemalloc") != hn_rain_stills.title_key("Waymo")
    assert hn_rain_stills.title_slug("Exfiltrate weights?") == "exfiltrate-weights"


def test_cache_roundtrip(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(hn_rain_stills, "stills_dir", lambda: tmp_path)
    svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><rect width="8" height="8"/></svg>'
    dest = hn_rain_stills.write_cached("Jemalloc", svg)
    assert dest.name == "jemalloc.svg"
    assert dest.read_text(encoding="utf-8") == svg
    assert (tmp_path / f"{hn_rain_stills.title_key('Jemalloc')}.svg").is_file()
    assert hn_rain_stills.read_cached("jemalloc") == svg
    assert hn_rain_stills.read_cached("missing") is None


def test_enqueue_is_pending_until_cached(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    hn_rain_stills.reset_queue()
    monkeypatch.setattr(hn_rain_stills, "stills_dir", lambda: tmp_path)
    monkeypatch.setattr(hn_rain_stills.cursor_agent, "read_key", lambda: "k")
    started: list[str] = []

    async def fake(title: str) -> str:
        started.append(title)
        return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><rect width="8" height="8"/></svg>'

    monkeypatch.setattr(hn_rain_stills, "generate_svg", fake)

    async def _run() -> None:
        assert hn_rain_stills.enqueue("Jemalloc") == "pending"
        assert hn_rain_stills.enqueue("Waymo") == "pending"
        assert hn_rain_stills.enqueue("Jemalloc") == "pending"
        assert hn_rain_stills._queue is not None
        await hn_rain_stills._queue.join()
        assert started == ["Jemalloc", "Waymo"]
        assert hn_rain_stills.enqueue("Jemalloc") == "cached"

    asyncio.run(_run())
    hn_rain_stills.reset_queue()


def test_still_without_key_asks_for_env() -> None:
    async def _inner() -> None:
        app = web.Application()
        app.router.add_get("/api/plugins/hn-rain/still", hn_rain_stills.api_still)
        client = TestClient(TestServer(app))
        await client.start_server()
        try:
            with patch("service.hn_rain_stills.cursor_agent.read_key", return_value=""):
                async with client.get("/api/plugins/hn-rain/still", params={"title": "Jemalloc"}) as resp:
                    assert resp.status == 503
                    body = await resp.json()
                    assert body["status"] == "need-key"
                    assert "CURSOR_API_KEY" in body["error"]
        finally:
            await client.close()

    asyncio.run(_inner())
