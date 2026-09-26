"""Request guard: Host allowlist, traversal paths, CSP origin, frame headers (make_app)."""
from __future__ import annotations

import asyncio
import logging
import tempfile
from pathlib import Path

import pytest
from aiohttp import ClientSession

from service import access, pack_asset_frames, request_guard
from service.request_guard import HOST_REJECT_BODY
from tests.monitor_app_test_util import access_log_capture, host_header, make_app_server, raw_http_url
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
]


def _dist_with_sandbox() -> Path:
    dist = Path(tempfile.mkdtemp())
    dist.joinpath("plugin-sandbox.html").write_text(
        f"<html><body>{SANDBOX_SNIPPET}</body></html>",
        encoding="utf-8",
    )
    dist.joinpath("index.html").write_text("<html><body>index</body></html>", encoding="utf-8")
    return dist


async def _access_log_redacts() -> None:
    dist = _dist_with_sandbox()
    frame = new_frame_id()
    async with make_app_server(web_dist=dist) as (ip, port, runner):
        runner.app["pack_asset_secret"] = SECRET
        reg = pack_asset_frames.registry_for_app(runner.app)
        reg.register(SESSION, frame)
        tok = mint("demo-pack", session_id=SESSION, frame_id=frame, app=runner.app)
        path = access.pack_asset_url(tok, "demo-pack", "module.js")
        sandbox_path = access.pack_asset_url(tok, "_sandbox", "plugin-sandbox.html")
        async with access_log_capture() as access_lines:
            app_log: list[str] = []
            root = logging.getLogger()
            handler = logging.Handler()
            handler.emit = lambda record: app_log.append(record.getMessage())  # type: ignore[method-assign]
            root.addHandler(handler)
            root.setLevel(logging.INFO)
            try:
                async with ClientSession() as session:
                    h = host_header(port)
                    async with session.get(
                        f"http://{ip}:{port}{path}",
                        headers={**h, access.HEADER: SESSION},
                    ) as resp:
                        assert resp.status in {200, 401, 403, 404}
                    async with session.get(
                        f"http://{ip}:{port}{sandbox_path}",
                        headers={**h, access.HEADER: SESSION, "Origin": "null"},
                    ) as resp2:
                        assert resp2.status in {200, 401, 403, 404}
            finally:
                root.removeHandler(handler)
        joined = "\n".join(access_lines + app_log)
        assert tok not in joined
        assert joined.count(access.SANDBOX_TOKEN_REDACT) >= 1
        assert joined.count("module.js") >= 1


def test_access_log_redacts_pack_asset_token_and_sandbox_page() -> None:
    asyncio.run(_access_log_redacts())


async def _host_injection() -> None:
    async with make_app_server() as (ip, port, _runner):
        async with ClientSession() as session:
            async with session.get(
                f"http://{ip}:{port}/api/session",
                headers={"Host": "evil; connect-src *"},
            ) as resp:
                assert resp.status == 400
                assert resp.headers.get("Content-Security-Policy") is None


def test_host_injection_returns_400_without_csp() -> None:
    asyncio.run(_host_injection())


async def _lan_host_csp() -> None:
    lan = "192.168.1.20"
    dist = _dist_with_sandbox()
    async with make_app_server(web_dist=dist) as (ip, port, runner):
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
                csp = resp.headers.get("Content-Security-Policy") or ""
                want = f"http://{lan}:{port}/pack-assets/{tok}/"
                assert f"script-src {want}" in csp
                assert "*" not in csp


def test_lan_host_csp_uses_validated_origin_not_wildcard() -> None:
    asyncio.run(_lan_host_csp())


async def _localhost_csp() -> None:
    dist = _dist_with_sandbox()
    async with make_app_server(web_dist=dist) as (ip, port, runner):
        runner.app["pack_asset_secret"] = SECRET
        frame = new_frame_id()
        pack_asset_frames.registry_for_app(runner.app).register(SESSION, frame)
        tok = mint("_sandbox", session_id=SESSION, frame_id=frame, app=runner.app)
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
                csp = resp.headers.get("Content-Security-Policy") or ""
                assert f"http://localhost:{port}/pack-assets/{tok}/" in csp
                assert "*" not in csp


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


@pytest.mark.parametrize("path", TRAVERSAL_PATHS)
def test_dot_segments_return_400_without_sandbox_leak(path: str) -> None:
    asyncio.run(_dot_segment(path))


async def _frame_case(case: str) -> None:
    dist = _dist_with_sandbox()
    async with make_app_server(web_dist=dist) as (ip, port, _runner):
        async with ClientSession() as session:
            if case == "__rejected_host__":
                async with session.get(
                    f"http://{ip}:{port}/",
                    headers={"Host": f"evil.example:{port}"},
                ) as resp:
                    assert resp.status == 400
                    assert resp.headers.get("X-Frame-Options") == "SAMEORIGIN"
                    csp = resp.headers.get("Content-Security-Policy") or ""
                    assert "frame-ancestors 'self'" in csp
                return
            headers = host_header(port)
            if case.startswith("/pack-assets/"):
                headers = {**headers, access.HEADER: SESSION}
            async with session.get(f"http://{ip}:{port}{case}", headers=headers) as resp:
                assert resp.status in {200, 401, 404}
                assert resp.headers.get("X-Frame-Options") == "SAMEORIGIN"
                csp = resp.headers.get("Content-Security-Policy") or ""
                assert "frame-ancestors 'self'" in csp


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


def test_plugin_sandbox_html_not_served_from_static_root() -> None:
    asyncio.run(_direct_plugin_sandbox_404())
