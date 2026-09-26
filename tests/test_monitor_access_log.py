"""Smoke: make_app boots with RedactingAccessLogger (access_log_class wiring)."""
from __future__ import annotations

import asyncio
import inspect
from unittest.mock import MagicMock

from aiohttp import ClientSession, web

from service import access, monitor


async def _session_smoke() -> None:
    state = MagicMock()
    app = monitor.make_app(state, "")
    app.on_startup.clear()
    app.on_shutdown.clear()
    app.on_cleanup.clear()
    runner = web.AppRunner(app, access_log_class=access.RedactingAccessLogger)
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
    from service import pack_asset_tokens
    from tests.pack_asset_test_util import SESSION, SECRET, mint, new_frame_id

    state = MagicMock()
    app = monitor.make_app(state, "")
    app.on_startup.clear()
    app.on_shutdown.clear()
    app.on_cleanup.clear()
    frame = new_frame_id()
    reg = app["pack_asset_frame_registry"]
    reg.register(SESSION, frame)
    tok = pack_asset_tokens.mint_pack_asset_token(SECRET, SESSION, "demo-pack", frame)
    runner = web.AppRunner(app, access_log_class=access.RedactingAccessLogger)
    await runner.setup()
    site = web.TCPSite(runner, "127.0.0.1", 0)
    await site.start()
    try:
        port = site._server.sockets[0].getsockname()[1]
        host = f"127.0.0.1:{port}"
        path = access.pack_asset_url(tok, "demo-pack", "module.js")
        async with ClientSession() as session:
            async with session.get(f"http://{host}{path}", headers={"Host": host}) as resp:
                assert resp.status in {401, 403, 404}
        req = type(
            "Req",
            (),
            {
                "remote": "127.0.0.1",
                "method": "GET",
                "path": path.split("?", 1)[0],
                "path_qs": path,
                "version": type("V", (), {"major": 1, "minor": 1})(),
            },
        )()
        line = access.RedactingAccessLogger._format_r(req, web.Response(text="ok"), 0.001)
        assert tok not in line
        assert access.SANDBOX_TOKEN_REDACT in line
    finally:
        await runner.cleanup()


def test_make_app_session_returns_200_with_redacting_access_logger() -> None:
    asyncio.run(_session_smoke())
    asyncio.run(_redacting_logger_smoke())
