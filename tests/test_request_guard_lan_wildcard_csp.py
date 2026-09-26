"""Wildcard LAN bind: sandbox CSP must use validated Host origin, not 0.0.0.0."""
from __future__ import annotations

import asyncio
import tempfile
from pathlib import Path
from urllib.parse import quote

from unittest.mock import patch

from aiohttp import ClientSession

from service import access, pack_asset_frames, plugins
from tests.lan_guard_test_util import LAN_STUB_IFACE_IP, stub_lan_os_interfaces
from tests.monitor_app_test_util import host_header, make_app_server
from tests.pack_asset_test_util import SECRET, SESSION, mint, new_frame_id

pytestmark = __import__("pytest").mark.usefixtures("stub_lan_os_interfaces")


def _dist_with_sandbox() -> Path:
    dist = Path(tempfile.mkdtemp())
    dist.joinpath("plugin-sandbox.html").write_text("<html><body>x</body></html>", encoding="utf-8")
    dist.joinpath("index.html").write_text("<html><body>index</body></html>", encoding="utf-8")
    return dist


def test_lan_bind_wildcard_csp_uses_validated_host_origin(stub_lan_os_interfaces) -> None:
    dist = _dist_with_sandbox()
    port_pin = 18440

    async def run() -> None:
        async with make_app_server(
            web_dist=dist,
            bind="0.0.0.0",
            insecure_lan=True,
            listen_port=port_pin,
        ) as (ip, port, runner):
            assert port == port_pin
            runner.app["pack_asset_secret"] = SECRET
            frame = new_frame_id()
            pack_asset_frames.registry_for_app(runner.app).register(SESSION, frame)
            tok = mint("_sandbox", session_id=SESSION, frame_id=frame, app=runner.app)
            tok_q = quote(tok, safe="")
            origin = f"http://{LAN_STUB_IFACE_IP}:{port}"
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
            row = {"id": "_sandbox", "has_frontend": True}
            with patch.object(plugins, "_plugin_row", lambda pid: row if pid == "_sandbox" else None):
                with patch.object(plugins, "consented", lambda _doc: True):
                    async with ClientSession() as session:
                        async with session.get(
                            f"http://{ip}:{port}{access.pack_asset_url(tok, '_sandbox', 'plugin-sandbox.html')}",
                            headers={
                                **host_header(port, LAN_STUB_IFACE_IP),
                                access.HEADER: SESSION,
                                "Origin": "null",
                            },
                        ) as resp:
                            assert resp.status == 200
                            csp = resp.headers.get("Content-Security-Policy") or ""
                            assert csp.find("0.0.0.0") == -1
                            assert csp == want_csp

    asyncio.run(run())
