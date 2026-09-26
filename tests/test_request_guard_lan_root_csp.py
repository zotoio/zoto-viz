"""LAN GET / sandbox CSP uses validated box IP, never bind wildcard."""
from __future__ import annotations

import asyncio
import tempfile
from pathlib import Path

import pytest
from aiohttp import ClientSession

from service import access, pack_asset_frames
from tests.lan_guard_test_util import LAN_STUB_IFACE_IP, stub_lan_os_interfaces
from tests.monitor_app_test_util import make_app_server
from tests.pack_asset_test_util import SECRET, SESSION, mint, new_frame_id


def _dist_with_sandbox() -> Path:
    dist = Path(tempfile.mkdtemp())
    dist.joinpath("plugin-sandbox.html").write_text("<html><body>sandbox</body></html>", encoding="utf-8")
    dist.joinpath("index.html").write_text("<html><body>index</body></html>", encoding="utf-8")
    return dist


def test_lan_get_root_sandbox_csp_names_box_ip_zero_bind_wildcards(stub_lan_os_interfaces) -> None:
    dist = _dist_with_sandbox()

    async def run() -> None:
        async with make_app_server(web_dist=dist, bind="0.0.0.0", insecure_lan=True) as (ip, port, runner):
            runner.app["pack_asset_secret"] = SECRET
            frame = new_frame_id()
            pack_asset_frames.registry_for_app(runner.app).register(SESSION, frame)
            tok = mint("_sandbox", session_id=SESSION, frame_id=frame, app=runner.app)
            host = f"{LAN_STUB_IFACE_IP}:{port}"
            async with ClientSession() as session:
                async with session.get(
                    f"http://{ip}:{port}{access.pack_asset_url(tok, '_sandbox', 'plugin-sandbox.html')}",
                    headers={"Host": host, access.HEADER: SESSION},
                ) as resp:
                    assert resp.status == 200
                    want = f"http://{LAN_STUB_IFACE_IP}:{port}/pack-assets/{tok}/"
                    csp = resp.headers.get("Content-Security-Policy") or ""
                    assert f"script-src {want}" in csp
                    joined = "\n".join(f"{k}: {v}" for k, v in resp.headers.items())
                    assert joined.count("0.0.0.0") == 0

    asyncio.run(run())
