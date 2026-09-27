"""Real ``make_app`` servers for monitor integration tests."""
from __future__ import annotations

import asyncio
import logging
from collections.abc import Callable
from contextlib import asynccontextmanager
from typing import AsyncIterator
from unittest.mock import MagicMock

from aiohttp import web
from yarl import URL

from service import monitor, request_guard


@asynccontextmanager
async def make_app_server(
    *,
    allowed_hosts: list[str] | None = None,
    web_dist=None,
    bind: str = "127.0.0.1",
    insecure_lan: bool = False,
    listen_port: int = 0,
    clock: Callable[[], float] | None = None,
) -> AsyncIterator[tuple[str, int, web.AppRunner]]:
    state = MagicMock()
    orig_dist = monitor.WEB_DIST
    if web_dist is not None:
        monitor.WEB_DIST = web_dist
    initial_port = listen_port if listen_port else 7020
    app = monitor.make_app(
        state,
        "",
        bind=bind,
        port=initial_port,
        allowed_hosts=allowed_hosts or [],
        insecure_lan=insecure_lan,
    )
    app.on_startup.clear()
    app.on_shutdown.clear()
    app.on_cleanup.clear()
    if clock is not None:
        app["request_guard_clock"] = clock
    runner = web.AppRunner(app, access_log=monitor.run_app_kwargs().get("access_log"))
    await runner.setup()
    site = web.TCPSite(
        runner,
        bind if bind not in {"0.0.0.0", "::"} else "127.0.0.1",
        listen_port,
    )
    await site.start()
    port = int(site._server.sockets[0].getsockname()[1])
    if clock is not None or port != initial_port:
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
        await runner.cleanup()


def host_header(port: int, host: str = "127.0.0.1") -> dict[str, str]:
    return {"Host": f"{host}:{port}"}


def raw_http_url(ip: str, port: int, path: str) -> URL:
    """HTTP URL that preserves ``..`` segments (yarl would normalize otherwise)."""
    return URL.build(scheme="http", host=f"{ip}:{port}", path=path, encoded=True)


async def raw_http_exchange(ip: str, port: int, request: bytes) -> tuple[int, str, bytes]:
    """Send raw bytes on the wire; return ``(status_code, reason, body)``."""
    reader, writer = await asyncio.open_connection(ip, port)
    writer.write(request)
    await writer.drain()
    writer.write_eof()
    raw = b""
    while True:
        chunk = await reader.read(65536)
        if not chunk:
            break
        raw += chunk
    writer.close()
    await writer.wait_closed()
    if b"\r\n\r\n" not in raw:
        return 0, "", raw
    head, _, body = raw.partition(b"\r\n\r\n")
    status_line = head.split(b"\r\n", 1)[0].decode("latin-1", errors="replace")
    parts = status_line.split(" ", 2)
    code = int(parts[1]) if len(parts) >= 2 and parts[1].isdigit() else 0
    reason = parts[2] if len(parts) >= 3 else ""
    return code, reason, body


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
