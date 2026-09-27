"""Smoke: make_app boots; production disables aiohttp access logging."""
from __future__ import annotations

import asyncio
from unittest.mock import MagicMock

from aiohttp import ClientSession, web

from service import monitor, request_guard


async def _session_smoke() -> None:
    state = MagicMock()
    app = monitor.make_app(state, "", bind="127.0.0.1", port=7020)
    app.on_startup.clear()
    app.on_shutdown.clear()
    app.on_cleanup.clear()
    runner = web.AppRunner(app, access_log=monitor.run_app_kwargs()["access_log"])
    await runner.setup()
    site = web.TCPSite(runner, "127.0.0.1", 0)
    await site.start()
    try:
        port = site._server.sockets[0].getsockname()[1]
        request_guard.configure_request_guard(app, bind="127.0.0.1", port=port)
        url = f"http://127.0.0.1:{port}/api/session"
        async with ClientSession() as session:
            async with session.get(url, headers={"Host": f"127.0.0.1:{port}"}) as resp:
                assert resp.status == 200
                data = await resp.json()
                assert "csrf" in data
                assert isinstance(data["csrf"], str)
    finally:
        await runner.cleanup()


def test_make_app_session_and_production_access_log_disabled() -> None:
    asyncio.run(_session_smoke())
    kw = monitor.run_app_kwargs()
    assert kw["print"] is None
    assert kw["access_log"] is None
    assert kw["shutdown_timeout"] == 3


def test_make_app_configures_request_guard() -> None:
    from unittest.mock import MagicMock

    app = monitor.make_app(MagicMock(), "", bind="127.0.0.1", port=7020)
    assert app.get("request_guard_allowed_hosts") == frozenset(
        {"localhost:7020", "127.0.0.1:7020", "[::1]:7020"},
    )
