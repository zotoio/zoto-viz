"""Real ``make_app`` servers for monitor integration tests."""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from typing import AsyncIterator
from unittest.mock import MagicMock

from aiohttp import web
from yarl import URL

from service import monitor, pack_assets, request_guard


@asynccontextmanager
async def make_app_server(
    *,
    allowed_hosts: list[str] | None = None,
    web_dist=None,
    bind: str = "127.0.0.1",
    insecure_lan: bool = False,
) -> AsyncIterator[tuple[str, int, web.AppRunner]]:
    state = MagicMock()
    orig_dist = monitor.WEB_DIST
    orig_pack_dist = pack_assets.WEB_DIST
    if web_dist is not None:
        monitor.WEB_DIST = web_dist
        pack_assets.WEB_DIST = web_dist
    app = monitor.make_app(
        state,
        "",
        bind=bind,
        port=7020,
        allowed_hosts=allowed_hosts or [],
        setup_request_guard=False,
        insecure_lan=insecure_lan,
    )
    app.on_startup.clear()
    app.on_shutdown.clear()
    app.on_cleanup.clear()
    request_guard.reset_interface_lookup_counter()
    runner = web.AppRunner(app, access_log=monitor.run_app_kwargs()["access_log"])
    await runner.setup()
    site = web.TCPSite(runner, bind if bind not in {"0.0.0.0", "::"} else "127.0.0.1", 0)
    await site.start()
    port = int(site._server.sockets[0].getsockname()[1])
    request_guard.configure_request_guard(
        app,
        bind=bind,
        port=port,
        allowed_hosts=allowed_hosts or [],
    )
    try:
        yield "127.0.0.1", port, runner
    finally:
        monitor.WEB_DIST = orig_dist
        pack_assets.WEB_DIST = orig_pack_dist
        await runner.cleanup()


def host_header(port: int, host: str = "127.0.0.1") -> dict[str, str]:
    return {"Host": f"{host}:{port}"}


def raw_http_url(ip: str, port: int, path: str) -> URL:
    """HTTP URL that preserves ``..`` segments (yarl would normalize otherwise)."""
    return URL.build(scheme="http", host=f"{ip}:{port}", path=path, encoded=True)


@asynccontextmanager
async def access_log_capture() -> AsyncIterator[list[str]]:
    captured: list[str] = []
    log = logging.getLogger("aiohttp.access")
    handler = logging.Handler()
    handler.emit = lambda record: captured.append(record.getMessage())  # type: ignore[method-assign]
    log.addHandler(handler)
    log.setLevel(logging.INFO)
    try:
        yield captured
    finally:
        log.removeHandler(handler)
