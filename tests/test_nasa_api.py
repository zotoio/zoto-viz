from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path
from unittest.mock import patch

import pytest
from aiohttp import ClientSession

from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer

from service import access
from service import logbuf
from service import nasa_api
from service import request_guard
from service import sources
from tests.monitor_app_test_util import host_header, make_app_server


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


async def _nasa_key_app_no_access_middleware() -> tuple[TestClient, int]:
    app = web.Application(middlewares=[request_guard.middleware])
    app["csrf"] = "token-nasa-guard"
    app["insecure_lan"] = False
    request_guard.register_response_prepare_hook(app)
    app.router.add_put("/api/sources/nasa-api-key", nasa_api.api_nasa_key)
    app.router.add_get("/api/sources/nasa-api-key", nasa_api.api_nasa_key)
    client = TestClient(TestServer(app))
    await client.start_server()
    port = client.port
    request_guard.configure_request_guard(app, bind="127.0.0.1", port=port)
    return client, port


def test_nasa_key_handler_guard_rejects_put_without_csrf() -> None:
    async def run() -> None:
        client, port = await _nasa_key_app_no_access_middleware()
        try:
            resp = await client.put(
                "/api/sources/nasa-api-key",
                json={"key": FAKE_KEY},
                headers=host_header(port),
            )
            assert resp.status == 403
            body = await resp.json()
            assert body.get("error") == "csrf required"
        finally:
            await client.close()

    asyncio.run(run())


def test_nasa_key_handler_guard_rejects_cross_origin() -> None:
    async def run() -> None:
        client, port = await _nasa_key_app_no_access_middleware()
        try:
            resp = await client.put(
                "/api/sources/nasa-api-key",
                json={"key": FAKE_KEY},
                headers={
                    **host_header(port),
                    access.HEADER: "token-nasa-guard",
                    "Origin": "http://evil.example",
                },
            )
            assert resp.status == 403
            body = await resp.json()
            assert body.get("error") == "forbidden origin"
        finally:
            await client.close()

    asyncio.run(run())


def test_nasa_key_put_rejects_cross_origin() -> None:
    async def run() -> None:
        async with make_app_server() as (ip, port, _runner):
            async with ClientSession() as session:
                async with session.get(
                    f"http://{ip}:{port}/api/session",
                    headers=host_header(port, ip),
                ) as boot:
                    token = boot.headers.get(access.HEADER, "")
                async with session.put(
                    f"http://{ip}:{port}/api/sources/nasa-api-key",
                    json={"key": FAKE_KEY},
                    headers={
                        **host_header(port, ip),
                        access.HEADER: token,
                        "Origin": "http://evil.example",
                    },
                ) as resp:
                    assert resp.status == 403
                    body = await resp.json()
                    assert body.get("error") == "forbidden origin"

    asyncio.run(run())


def test_nasa_key_put_rejects_without_csrf_token() -> None:
    async def run() -> None:
        async with make_app_server() as (ip, port, _runner):
            async with ClientSession() as session:
                async with session.put(
                    f"http://{ip}:{port}/api/sources/nasa-api-key",
                    json={"key": FAKE_KEY},
                    headers=host_header(port, ip),
                ) as resp:
                    assert resp.status == 403
                    body = await resp.json()
                    assert body.get("error") == "csrf required"

    asyncio.run(run())


def test_nasa_key_get_never_returns_secret() -> None:
    async def run() -> None:
        async with make_app_server() as (ip, port, _runner):
            async with ClientSession() as session:
                async with session.get(
                    f"http://{ip}:{port}/api/session",
                    headers=host_header(port, ip),
                ) as boot:
                    token = boot.headers.get(access.HEADER, "")
                async with session.put(
                    f"http://{ip}:{port}/api/sources/nasa-api-key",
                    json={"key": FAKE_KEY},
                    headers={**host_header(port, ip), access.HEADER: token},
                ) as put:
                    assert put.status == 200
                async with session.get(
                    f"http://{ip}:{port}/api/sources/nasa-api-key",
                    headers=host_header(port, ip),
                ) as resp:
                    blob = json.dumps(await resp.json())
                    assert FAKE_KEY not in blob
                    assert nasa_api.ENV_KEY not in blob

    asyncio.run(run())
