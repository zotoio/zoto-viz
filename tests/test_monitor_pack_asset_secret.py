"""make_app must install a pack-asset signing secret without test fixtures."""
from __future__ import annotations

import asyncio
import tempfile
from pathlib import Path
from unittest.mock import patch

from aiohttp import ClientSession

from service import access, pack_asset_frames, pack_asset_tokens, plugins
from tests.monitor_app_test_util import host_header, make_app_server
from tests.pack_asset_test_util import new_frame_id


def test_make_app_mints_pack_asset_urls_without_manual_secret() -> None:
    dist = Path(tempfile.mkdtemp())
    dist.joinpath("plugin-sandbox.html").write_text("<html></html>", encoding="utf-8")

    async def run() -> None:
        async with make_app_server(web_dist=dist, listen_port=18431) as (ip, port, runner):
            secret = runner.app.get("pack_asset_secret")
            assert len(secret or b"") == 32
            async with ClientSession() as session:
                async with session.get(
                    f"http://{ip}:{port}/api/session",
                    headers=host_header(port),
                ) as sess:
                    assert sess.status == 200
                    csrf = (await sess.json())["csrf"]
                    cookie = sess.cookies.get("csrf")
                frame = new_frame_id()
                pack_asset_frames.registry_for_app(runner.app).register(csrf, frame)
                tok = pack_asset_tokens.mint_pack_asset_token(
                    secret, csrf, "_sandbox", frame,
                )
                path = access.pack_asset_url(tok, "_sandbox", "plugin-sandbox.html")
                row = {"id": "_sandbox", "has_frontend": True}
                with patch.object(plugins, "_plugin_row", lambda pid: row if pid == "_sandbox" else None):
                    with patch.object(plugins, "consented", lambda _doc: True):
                        async with session.get(
                            f"http://{ip}:{port}{path}",
                            headers={
                                **host_header(port),
                                access.HEADER: csrf,
                                "Origin": "null",
                                "Cookie": f"csrf={cookie}",
                            },
                        ) as resp:
                            assert resp.status == 200

    asyncio.run(run())
