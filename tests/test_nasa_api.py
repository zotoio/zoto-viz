from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path
from unittest.mock import patch

import pytest
from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer

from service import logbuf
from service import nasa_api
from service import sources


FAKE_KEY = "fake-nasa-key-for-tests-only"


@pytest.fixture(autouse=True)
def _iso(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    home = tmp_path / "home"
    home.mkdir()
    user = home / ".zoto-viz"
    user.mkdir()
    monkeypatch.setattr(nasa_api.paths, "user_dir", lambda: user)
    monkeypatch.setattr(sources.paths, "user_dir", lambda: user)
    monkeypatch.setattr(Path, "home", staticmethod(lambda: home))
    monkeypatch.setattr(sources.agent_assets, "check_url", lambda u: u.strip())
    os.environ.pop(nasa_api.ENV_KEY, None)
    nasa_api.clear_key()
    sources.reset_for_tests()
    logbuf.reset_for_tests()
    return user


def test_resolve_fetch_url_uses_host_key_when_set() -> None:
    with patch.dict(os.environ, {nasa_api.ENV_KEY: FAKE_KEY}):
        url = sources.resolve_fetch_url("https://api.nasa.gov/planetary/apod?count=8")
        assert f"api_key={FAKE_KEY}" in url
        assert FAKE_KEY in url


def test_resolve_fetch_url_uses_demo_key_and_note_when_absent() -> None:
    url = sources.resolve_fetch_url("https://api.nasa.gov/planetary/apod")
    assert "api_key=DEMO_KEY" in url
    row = {"id": "apod", "type": "http", "label": "APOD", "feed": True}
    sources._record(row, ok=True, payload={"items": []})
    live = sources.snapshot()["apod"]
    assert live.get("note") == nasa_api.DEMO_NOTE


def test_api_and_snapshot_never_expose_key() -> None:
    with patch.dict(os.environ, {nasa_api.ENV_KEY: FAKE_KEY}):
        nasa_api.write_key(FAKE_KEY)
        sources._record(
            {"id": "apod", "type": "http", "label": "APOD", "feed": True, "url": "https://api.nasa.gov/planetary/apod"},
            ok=False,
            error=f"http 429 for https://api.nasa.gov/planetary/apod?api_key={FAKE_KEY}",
        )
        snap = sources.snapshot()
        blob = json.dumps(sources.config_payload())
        assert FAKE_KEY not in blob
        assert FAKE_KEY not in json.dumps(snap)
        assert FAKE_KEY not in (snap.get("apod") or {}).get("error", "")
        logbuf.record(f"apod fetch failed api_key={FAKE_KEY}")
        logs = json.dumps(logbuf.since(0))
        assert FAKE_KEY not in logs


def test_write_key_persists_host_env(tmp_path: Path) -> None:
    nasa_api.write_key(FAKE_KEY)
    text = nasa_api.host_env_file().read_text(encoding="utf-8")
    assert f"NASA_API_KEY={FAKE_KEY}" in text
    assert nasa_api.read_key() == FAKE_KEY


def _run(coro):
    return asyncio.run(coro)


def test_nasa_key_api_roundtrip() -> None:
    async def _inner() -> None:
        app = web.Application()
        app.router.add_get("/api/sources/nasa-api-key", nasa_api.api_nasa_key)
        app.router.add_put("/api/sources/nasa-api-key", nasa_api.api_nasa_key)
        client = TestClient(TestServer(app))
        await client.start_server()
        try:
            async with client.get("/api/sources/nasa-api-key") as resp:
                assert (await resp.json())["configured"] is False
            async with client.put("/api/sources/nasa-api-key", json={"key": FAKE_KEY}) as resp:
                assert resp.status == 200
                assert (await resp.json())["nasaApiKeyConfigured"] is True
            async with client.get("/api/sources/nasa-api-key") as resp:
                body = await resp.json()
                assert body["configured"] is True
                assert FAKE_KEY not in json.dumps(body)
        finally:
            await client.close()

    _run(_inner())
