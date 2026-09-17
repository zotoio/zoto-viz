from __future__ import annotations

import asyncio
import os
from unittest.mock import patch

from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer

from service import typesafe_proxy


def test_api_key_configured_reads_monitor_env() -> None:
    with patch.dict(os.environ, {}, clear=True):
        assert typesafe_proxy.api_key_configured() is False
    with patch.dict(os.environ, {"TYPESAFE_API_KEY": " ts_test "}):
        assert typesafe_proxy.api_key_configured() is True


def test_noul_questions_maps_pack_prompts() -> None:
    qs = typesafe_proxy._noul_questions([{"id": "q1", "prompt": "Is traffic high?"}])
    assert qs["q1"]["type"] == "noul"
    assert qs["q1"]["instructions"] == "Is traffic high?"


def _run(coro):
    return asyncio.run(coro)


def test_status_without_key() -> None:
    async def _inner() -> None:
        app = web.Application()
        app.router.add_get("/api/typesafe/status", typesafe_proxy.api_status)
        client = TestClient(TestServer(app))
        await client.start_server()
        try:
            with patch.dict(os.environ, {}, clear=True):
                async with client.get("/api/typesafe/status") as resp:
                    assert resp.status == 200
                    assert (await resp.json()) == {"configured": False}
        finally:
            await client.close()

    _run(_inner())


def test_sense_without_key_returns_503() -> None:
    async def _inner() -> None:
        app = web.Application()
        app.router.add_post("/api/typesafe/sense", typesafe_proxy.api_sense)
        client = TestClient(TestServer(app))
        await client.start_server()
        try:
            with patch.dict(os.environ, {}, clear=True):
                async with client.post("/api/typesafe/sense", json={"state": {"x": 1}}) as resp:
                    assert resp.status == 503
        finally:
            await client.close()

    _run(_inner())


def test_sense_with_key_proxies_upstream() -> None:
    upstream = {"model": "jev-latest", "answers": {"q1": {"type": "noul", "noul": 0.8}}}

    class FakeResp:
        status = 200

        async def json(self, content_type=None):
            return upstream

    class FakeCtx:
        async def __aenter__(self):
            return FakeResp()

        async def __aexit__(self, *args):
            return None

    class FakeSession:
        def post(self, *args, **kwargs):
            return FakeCtx()

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

    async def _inner() -> None:
        app = web.Application()
        app.router.add_post("/api/typesafe/sense", typesafe_proxy.api_sense)
        client = TestClient(TestServer(app))
        await client.start_server()
        try:
            with patch.dict(os.environ, {"TYPESAFE_API_KEY": "test-key"}):
                with patch("service.typesafe_proxy.aiohttp.ClientSession", return_value=FakeSession()):
                    async with client.post(
                        "/api/typesafe/sense",
                        json={"state": {"devices": []}, "questions": [{"id": "q1", "prompt": "ping?"}]},
                    ) as resp:
                        assert resp.status == 200
                        body = await resp.json()
                        assert body["answer"] == upstream["answers"]
        finally:
            await client.close()

    _run(_inner())
