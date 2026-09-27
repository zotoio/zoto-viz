"""UX copy pinned as string literals (not production constants). One pytest row each."""
from __future__ import annotations

import asyncio
from unittest.mock import MagicMock

from aiohttp import ClientSession, web

from service import monitor, request_guard
from tests.monitor_app_test_util import host_header, make_app_server

_HOST_400_LITERAL = (
    "This zoto-viz server doesn't accept the address it was opened with. "
    "Open it by its IP address, or add this name to `allowed_hosts` in the server config."
)
_HANDLER_500_LITERAL = (
    "zoto-viz ran into a problem with this request. "
    "Reload to try again. If it keeps happening, check the server log."
)


def test_ux_literal_host_reject_400_body_malformed_and_disallowed() -> None:
    async def run() -> None:
        async with make_app_server() as (ip, port, _runner):
            async with ClientSession() as session:
                async with session.get(
                    f"http://{ip}:{port}/api/session",
                    headers={"Host": "evil; connect-src *"},
                ) as malformed:
                    assert malformed.status == 400
                    assert malformed.content_type == "text/plain"
                    assert "doesn't accept the address" in await malformed.text()
                async with session.get(
                    f"http://{ip}:{port}/api/session",
                    headers={"Host": f"evil.example:{port}"},
                ) as rejected:
                    assert rejected.status == 400
                    assert "doesn't accept the address" in await rejected.text()

    asyncio.run(run())


def test_ux_literal_handler_500_body() -> None:
    async def _boom(_req):  # noqa: ANN001
        raise RuntimeError("probe")

    async def run() -> None:
        state = MagicMock()
        app = monitor.make_app(state, "")
        app.router.add_get("/__probe_boom", _boom)
        app.on_startup.clear()
        app.on_shutdown.clear()
        app.on_cleanup.clear()
        runner = web.AppRunner(app, access_log=monitor.run_app_kwargs()["access_log"])
        await runner.setup()
        site = web.TCPSite(runner, "127.0.0.1", 0)
        await site.start()
        port = int(site._server.sockets[0].getsockname()[1])
        request_guard.configure_request_guard(app, bind="127.0.0.1", port=port)
        try:
            async with ClientSession() as session:
                async with session.get(
                    f"http://127.0.0.1:{port}/__probe_boom",
                    headers=host_header(port),
                ) as resp:
                    assert resp.status == 500
                    assert "Reload to try again" in await resp.text()
        finally:
            await runner.cleanup()

    asyncio.run(run())
