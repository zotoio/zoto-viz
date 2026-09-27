"""403 denials from access middleware must attach pack-asset + frame-embed headers."""
from __future__ import annotations

import asyncio

from aiohttp import ClientSession

from tests.monitor_app_test_util import host_header, make_app_server


async def _csrf_denied_has_frame_headers() -> None:
    async with make_app_server(listen_port=0) as (ip, port, _runner):
        async with ClientSession() as session:
            async with session.post(
                f"http://{ip}:{port}/api/profiles",
                headers=host_header(port),
                json={"id": "x"},
            ) as resp:
                assert resp.status == 403
                assert resp.headers.get("X-Content-Type-Options") == "nosniff"
                assert resp.headers.get("Cache-Control") == "no-store"


def test_csrf_denied_attaches_frame_and_pack_asset_headers() -> None:
    asyncio.run(_csrf_denied_has_frame_headers())
