"""Smoke: make_app boots; pack-asset tokens never appear in access logs."""
from __future__ import annotations

import asyncio
import logging
from unittest.mock import MagicMock

from aiohttp import ClientSession, web

from service import access, monitor, pack_asset_frames, pack_asset_tokens
from tests.pack_asset_test_util import SESSION, SECRET, mint, new_frame_id


async def _session_smoke() -> None:
    state = MagicMock()
    app = monitor.make_app(state, "")
    app.on_startup.clear()
    app.on_shutdown.clear()
    app.on_cleanup.clear()
    runner = web.AppRunner(app, access_log=None)
    await runner.setup()
    site = web.TCPSite(runner, "127.0.0.1", 0)
    await site.start()
    try:
        port = site._server.sockets[0].getsockname()[1]
        url = f"http://127.0.0.1:{port}/api/session"
        async with ClientSession() as session:
            async with session.get(url, headers={"Host": f"127.0.0.1:{port}"}) as resp:
                assert resp.status == 200
                data = await resp.json()
                assert "csrf" in data
                assert isinstance(data["csrf"], str)
    finally:
        await runner.cleanup()


async def _redacting_logger_smoke() -> None:
    state = MagicMock()
    app = monitor.make_app(state, "")
    app.on_startup.clear()
    app.on_shutdown.clear()
    app.on_cleanup.clear()
    frame = new_frame_id()
    reg = pack_asset_frames.registry_for_app(app)
    reg.register(SESSION, frame)
    tok = mint("demo-pack", session_id=SESSION, frame_id=frame)
    runner = web.AppRunner(app, access_log_class=access.RedactingAccessLogger)
    await runner.setup()
    site = web.TCPSite(runner, "127.0.0.1", 0)
    await site.start()
    captured: list[str] = []
    log = logging.getLogger("aiohttp.access")
    handler = logging.Handler()
    handler.emit = lambda record: captured.append(record.getMessage())  # type: ignore[method-assign]
    log.addHandler(handler)
    log.setLevel(logging.INFO)
    try:
        port = site._server.sockets[0].getsockname()[1]
        host = f"127.0.0.1:{port}"
        path = access.pack_asset_url(tok, "demo-pack", "module.js")
        async with ClientSession() as session:
            async with session.get(
                f"http://{host}{path}",
                headers={"Host": host, access.HEADER: SESSION},
            ) as resp:
                assert resp.status in {200, 401, 403, 404}
        assert captured, "expected aiohttp access log line"
        joined = "\n".join(captured)
        assert tok not in joined
        assert access.SANDBOX_TOKEN_REDACT in joined
    finally:
        log.removeHandler(handler)
        await runner.cleanup()


def test_make_app_session_returns_200_with_redacting_access_logger() -> None:
    asyncio.run(_session_smoke())
    asyncio.run(_redacting_logger_smoke())
