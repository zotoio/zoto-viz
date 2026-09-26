"""Request guard: Host allowlist, traversal paths, CSP origin, frame headers (make_app)."""
from __future__ import annotations

import asyncio
import logging
import tempfile
from pathlib import Path

import pytest
from aiohttp import ClientSession

from service import access, monitor, pack_asset_frames, request_guard
from service.request_guard import HANDLER_ERROR_BODY, HOST_REJECT_BODY
from tests.monitor_app_test_util import host_header, make_app_server, raw_http_url
from tests.pack_asset_test_util import SECRET, SESSION, mint, new_frame_id

SANDBOX_SNIPPET = "zoto-viz-plugin-sandbox-leak"
TRAVERSAL_PATHS = [
    "/ws/../plugin-sandbox.html",
    "/wsx/../",
    "/ws/..%2f",
    "/ws%2f..%2f",
    "/wsfoo%2f..%2f",
    "/api/../",
    "/api/%2e%2e/",
    "/mcp/../",
    "/pack-assets/../",
]

FRAME_CASES = [
    "/",
    "/index.html",
    "/api/session",
    "/no-such-path",
    "/pack-assets/bad-token/demo/module.js",
    "__rejected_host__",
    "__host_format_trailing_dot__",
    "__host_format_missing_port__",
    "__host_format_zone_id__",
    "__host_format_injection__",
]


def _dist_with_sandbox() -> Path:
    dist = Path(tempfile.mkdtemp())
    dist.joinpath("plugin-sandbox.html").write_text(
        f"<html><body>{SANDBOX_SNIPPET}</body></html>",
        encoding="utf-8",
    )
    dist.joinpath("index.html").write_text("<html><body>index</body></html>", encoding="utf-8")
    return dist


def _assert_frame_headers(resp) -> None:
    assert resp.headers.get("X-Frame-Options") == "SAMEORIGIN"
    csp = resp.headers.get("Content-Security-Policy") or ""
    assert "frame-ancestors 'self'" in csp


async def _host_injection() -> None:
    async with make_app_server() as (ip, port, _runner):
        async with ClientSession() as session:
            async with session.get(
                f"http://{ip}:{port}/api/session",
                headers={"Host": "evil; connect-src *"},
            ) as resp:
                assert resp.status == 400
                assert resp.content_type == "text/plain"
                body = await resp.text()
                assert body == HOST_REJECT_BODY
                assert "evil" not in body
                assert "connect-src" not in body
                _assert_frame_headers(resp)
                assert resp.headers.get("Content-Security-Policy") is not None
                assert "frame-ancestors 'self'" in (resp.headers.get("Content-Security-Policy") or "")


def test_host_injection_returns_400_with_frame_headers() -> None:
    asyncio.run(_host_injection())


async def _main_lan_csp() -> None:
    dist = _dist_with_sandbox()
    async with make_app_server(web_dist=dist, bind="0.0.0.0", insecure_lan=True) as (ip, port, runner):
        runner.app["pack_asset_secret"] = SECRET
        frame = new_frame_id()
        pack_asset_frames.registry_for_app(runner.app).register(SESSION, frame)
        tok = mint("_sandbox", session_id=SESSION, frame_id=frame, app=runner.app)
        async with ClientSession() as session:
            async with session.get(
                f"http://{ip}:{port}{access.pack_asset_url(tok, '_sandbox', 'plugin-sandbox.html')}",
                headers={
                    **host_header(port),
                    access.HEADER: SESSION,
                },
            ) as resp:
                assert resp.status == 200
                csp = resp.headers.get("Content-Security-Policy") or ""
                want = f"http://127.0.0.1:{port}/pack-assets/{tok}/"
                assert f"script-src {want}" in csp
                assert "0.0.0.0" not in csp
                assert "*" not in csp


def test_lan_bind_wildcard_csp_uses_validated_host_origin() -> None:
    asyncio.run(_main_lan_csp())


async def _lan_host_csp() -> None:
    lan = "192.168.1.20"
    dist = _dist_with_sandbox()
    port_pin = 18420
    async with make_app_server(web_dist=dist, listen_port=port_pin) as (ip, port, runner):
        assert port == port_pin
        request_guard.configure_request_guard(
            runner.app, bind="127.0.0.1", port=port, allowed_hosts=[f"{lan}:{port}"],
        )
        runner.app["pack_asset_secret"] = SECRET
        frame = new_frame_id()
        pack_asset_frames.registry_for_app(runner.app).register(SESSION, frame)
        tok = mint("_sandbox", session_id=SESSION, frame_id=frame, app=runner.app)
        async with ClientSession() as session:
            async with session.get(
                f"http://{ip}:{port}{access.pack_asset_url(tok, '_sandbox', 'plugin-sandbox.html')}",
                headers={
                    "Host": f"{lan}:{port}",
                    access.HEADER: SESSION,
                },
            ) as resp:
                assert resp.status == 200
                from urllib.parse import quote

                tok_q = quote(tok, safe="")
                origin = f"http://{lan}:{port}"
                want_csp = (
                    f"default-src 'none'; "
                    f"script-src {origin}/pack-assets/{tok_q}/; "
                    f"img-src {origin}/pack-assets/{tok_q}/; "
                    f"style-src {origin}/pack-assets/{tok_q}/; "
                    f"font-src {origin}/pack-assets/{tok_q}/; "
                    f"object-src 'none'; "
                    f"frame-src 'none'; "
                    f"worker-src 'none'; "
                    f"form-action 'none'; "
                    f"base-uri 'none'; "
                    f"connect-src 'none'; "
                    f"frame-ancestors 'self'"
                )
                assert resp.headers.get("Content-Security-Policy") == want_csp


def test_lan_host_csp_uses_validated_origin_not_wildcard() -> None:
    asyncio.run(_lan_host_csp())


async def _localhost_csp() -> None:
    dist = _dist_with_sandbox()
    port_pin = 18421
    async with make_app_server(web_dist=dist, listen_port=port_pin) as (ip, port, runner):
        assert port == port_pin
        runner.app["pack_asset_secret"] = SECRET
        frame = new_frame_id()
        pack_asset_frames.registry_for_app(runner.app).register(SESSION, frame)
        tok = mint("_sandbox", session_id=SESSION, frame_id=frame, app=runner.app)
        from urllib.parse import quote

        tok_q = quote(tok, safe="")
        origin = f"http://localhost:{port}"
        want_csp = (
            f"default-src 'none'; "
            f"script-src {origin}/pack-assets/{tok_q}/; "
            f"img-src {origin}/pack-assets/{tok_q}/; "
            f"style-src {origin}/pack-assets/{tok_q}/; "
            f"font-src {origin}/pack-assets/{tok_q}/; "
            f"object-src 'none'; "
            f"frame-src 'none'; "
            f"worker-src 'none'; "
            f"form-action 'none'; "
            f"base-uri 'none'; "
            f"connect-src 'none'; "
            f"frame-ancestors 'self'"
        )
        async with ClientSession() as session:
            async with session.get(
                f"http://{ip}:{port}{access.pack_asset_url(tok, '_sandbox', 'plugin-sandbox.html')}",
                headers={
                    **host_header(port, "localhost"),
                    "Origin": "null",
                    access.HEADER: SESSION,
                },
            ) as resp:
                assert resp.status == 200
                assert resp.headers.get("Content-Security-Policy") == want_csp


def test_localhost_host_csp_shape() -> None:
    asyncio.run(_localhost_csp())


async def _rebinding() -> None:
    async with make_app_server() as (ip, port, _runner):
        async with ClientSession() as session:
            async with session.get(
                f"http://{ip}:{port}/api/session",
                headers={"Host": f"evil.example:{port}"},
            ) as resp:
                body = await resp.text()
                assert resp.status == 400
                assert body == HOST_REJECT_BODY
                assert "evil.example" not in body
                assert "127.0.0.1" not in body
                _assert_frame_headers(resp)


def test_rebinding_host_400_exact_body_no_echo() -> None:
    asyncio.run(_rebinding())


async def _dot_segment(path: str) -> None:
    dist = _dist_with_sandbox()
    async with make_app_server(web_dist=dist) as (ip, port, _runner):
        async with ClientSession() as session:
            async with session.get(
                raw_http_url(ip, port, path),
                headers=host_header(port),
            ) as resp:
                body = await resp.text()
                assert resp.status == 400
                assert SANDBOX_SNIPPET not in body
                _assert_frame_headers(resp)


@pytest.mark.parametrize("path", TRAVERSAL_PATHS)
def test_dot_segments_return_400_without_sandbox_leak(path: str) -> None:
    asyncio.run(_dot_segment(path))


async def _frame_case(case: str) -> None:
    dist = _dist_with_sandbox()
    async with make_app_server(web_dist=dist) as (ip, port, runner):
        async with ClientSession() as session:
            if case == "__rejected_host__":
                async with session.get(
                    f"http://{ip}:{port}/",
                    headers={"Host": f"evil.example:{port}"},
                ) as resp:
                    assert resp.status == 400
                    _assert_frame_headers(resp)
                return
            if case == "__host_format_trailing_dot__":
                async with session.get(
                    f"http://{ip}:{port}/api/session",
                    headers={"Host": f"localhost.:{port}"},
                ) as resp:
                    assert resp.status == 400
                    assert await resp.text() == HOST_REJECT_BODY
                    _assert_frame_headers(resp)
                return
            if case == "__host_format_missing_port__":
                async with session.get(
                    f"http://{ip}:{port}/api/session",
                    headers={"Host": "127.0.0.1"},
                ) as resp:
                    assert resp.status == 400
                    assert await resp.text() == HOST_REJECT_BODY
                    _assert_frame_headers(resp)
                return
            if case == "__host_format_zone_id__":
                async with session.get(
                    f"http://{ip}:{port}/api/session",
                    headers={"Host": f"[fe80::1%eth0]:{port}"},
                ) as resp:
                    assert resp.status == 400
                    assert await resp.text() == HOST_REJECT_BODY
                    _assert_frame_headers(resp)
                return
            if case == "__host_format_injection__":
                async with session.get(
                    f"http://{ip}:{port}/api/session",
                    headers={"Host": "evil; connect-src *"},
                ) as resp:
                    assert resp.status == 400
                    _assert_frame_headers(resp)
                return
            headers = host_header(port)
            if case.startswith("/pack-assets/"):
                headers = {**headers, access.HEADER: SESSION}
            async with session.get(f"http://{ip}:{port}{case}", headers=headers) as resp:
                if case == "/pack-assets/bad-token/demo/module.js":
                    assert resp.status == 401
                elif case == "/no-such-path":
                    assert resp.status == 404
                else:
                    assert resp.status == 200
                _assert_frame_headers(resp)


@pytest.mark.parametrize("case", FRAME_CASES)
def test_frame_embed_policy_on_responses(case: str) -> None:
    asyncio.run(_frame_case(case))


async def _direct_plugin_sandbox_404() -> None:
    dist = _dist_with_sandbox()
    async with make_app_server(web_dist=dist) as (ip, port, _runner):
        async with ClientSession() as session:
            async with session.get(
                f"http://{ip}:{port}/plugin-sandbox.html",
                headers=host_header(port),
            ) as resp:
                assert resp.status == 404
                _assert_frame_headers(resp)


def test_plugin_sandbox_html_not_served_from_static_root() -> None:
    asyncio.run(_direct_plugin_sandbox_404())


async def _handler_500_frame_headers() -> None:
    from unittest.mock import MagicMock

    from aiohttp import web

    state = MagicMock()

    async def _boom(_req):  # noqa: ANN001
        raise RuntimeError("probe")

    app = monitor.make_app(state, "", setup_request_guard=False)
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
                assert resp.content_type == "text/plain"
                body = await resp.text()
                assert body == HANDLER_ERROR_BODY
                assert "probe" not in body
                assert "RuntimeError" not in body
                assert "127.0.0.1" not in body
                assert f":{port}" not in body
                _assert_frame_headers(resp)
    finally:
        await runner.cleanup()


def test_unhandled_handler_error_500_ux_body_and_frame_headers() -> None:
    asyncio.run(_handler_500_frame_headers())
