"""UX copy pinned as full string literals (exact equality, not substrings)."""
from __future__ import annotations

import asyncio
from unittest.mock import MagicMock

from aiohttp import ClientSession, web

from service import monitor, request_guard
from tests.monitor_app_test_util import host_header, make_app_server, raw_http_url

_HOST_REJECT_LITERAL = (
    "This zoto-viz server doesn't accept the address it was opened with. "
    "Open it by its IP address instead, or add this host name to allowed_hosts in the server config."
)
_HOST_HEADER_INVALID_LITERAL = (
    "This zoto-viz server couldn't read the address in this request. "
    "If you're using a proxy, check that it sends a single valid Host header."
)
_HANDLER_500_LITERAL = (
    "zoto-viz ran into a problem with this request. "
    "Reload to try again. If it keeps happening, check the server log."
)
_PATH_REJECT_LITERAL = (
    "zoto-viz can't open that page. Check the link and try again."
)


def test_ux_literal_host_reject_disallowed_body() -> None:
    assert request_guard.HOST_REJECT_BODY == _HOST_REJECT_LITERAL

    async def run() -> None:
        async with make_app_server() as (ip, port, _runner):
            async with ClientSession() as session:
                async with session.get(
                    f"http://{ip}:{port}/api/session",
                    headers={"Host": f"evil.example:{port}"},
                ) as rejected:
                    assert rejected.status == 400
                    assert rejected.content_type == "text/plain"
                    body = await rejected.text()
                    assert body == request_guard.HOST_REJECT_BODY
                    assert body == _HOST_REJECT_LITERAL

    asyncio.run(run())


def test_ux_literal_host_header_invalid_malformed_and_duplicate(monkeypatch) -> None:
    assert request_guard.HOST_HEADER_INVALID_BODY == _HOST_HEADER_INVALID_LITERAL

    async def run() -> None:
        async with make_app_server() as (ip, port, runner):
            async with ClientSession() as session:
                async with session.get(
                    f"http://{ip}:{port}/api/session",
                    headers={"Host": "evil; connect-src *"},
                ) as malformed:
                    assert malformed.status == 400
                    assert malformed.content_type == "text/plain"
                    body = await malformed.text()
                    assert body == request_guard.HOST_HEADER_INVALID_BODY
                    assert body == _HOST_HEADER_INVALID_LITERAL

            def _two_hosts(_request):  # noqa: ANN001
                return [f"127.0.0.1:{port}", f"evil.example:{port}"]

            monkeypatch.setattr(request_guard, "_host_header_values", _two_hosts)
            async with ClientSession() as session:
                async with session.get(
                    f"http://{ip}:{port}/api/session",
                    headers=host_header(port),
                ) as duplicate:
                    assert duplicate.status == 400
                    body = await duplicate.text()
                    assert body == request_guard.HOST_HEADER_INVALID_BODY
                    assert body == _HOST_HEADER_INVALID_LITERAL

    asyncio.run(run())


def test_ux_literal_handler_500_body() -> None:
    assert request_guard.HANDLER_ERROR_BODY == _HANDLER_500_LITERAL

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
                    body = await resp.text()
                    assert body == request_guard.HANDLER_ERROR_BODY
                    assert body == _HANDLER_500_LITERAL
        finally:
            await runner.cleanup()

    asyncio.run(run())


def test_ux_literal_path_reject_body() -> None:
    assert request_guard.PATH_REJECT_BODY == _PATH_REJECT_LITERAL

    async def run() -> None:
        async with make_app_server() as (ip, port, _runner):
            async with ClientSession() as session:
                async with session.get(
                    raw_http_url(ip, port, "/ws/../plugin-sandbox.html"),
                    headers=host_header(port),
                ) as resp:
                    assert resp.status == 400
                    body = await resp.text()
                    assert body == request_guard.PATH_REJECT_BODY
                    assert body == _PATH_REJECT_LITERAL

    asyncio.run(run())
