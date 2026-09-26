"""Smoke: make_app boots with RedactingAccessLogger (access_log_class wiring)."""
from __future__ import annotations

import asyncio
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


def test_make_app_session_returns_200_with_redacting_access_logger() -> None:
    asyncio.run(_session_smoke())
