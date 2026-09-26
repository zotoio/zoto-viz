"""Sandbox CSP must not trust injected Host header fragments (make_app + request guard)."""
from __future__ import annotations

import asyncio

from aiohttp import ClientSession

from service import access
from tests.monitor_app_test_util import make_app_server
from tests.pack_asset_test_util import SECRET, SESSION, mint, new_frame_id


async def _injected_host_blocked() -> None:
    async with make_app_server() as (ip, port, runner):
        runner.app["pack_asset_secret"] = SECRET
        frame = new_frame_id()
        from service import pack_asset_frames

        pack_asset_frames.registry_for_app(runner.app).register(SESSION, frame)
        tok = mint("_sandbox", session_id=SESSION, frame_id=frame, app=runner.app)
        evil = f"127.0.0.1:{port}; connect-src *"
        async with ClientSession() as session:
            async with session.get(
                f"http://{ip}:{port}{access.pack_asset_url(tok, '_sandbox', 'plugin-sandbox.html')}",
                headers={access.HEADER: SESSION, "Host": evil},
            ) as resp:
                assert resp.status == 400
                csp = resp.headers.get("Content-Security-Policy") or ""
                assert "connect-src *" not in csp
                assert "frame-ancestors 'self'" in csp


def test_injected_host_fragment_does_not_widen_csp() -> None:
    asyncio.run(_injected_host_blocked())
