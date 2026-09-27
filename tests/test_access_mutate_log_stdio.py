"""Production mutate access log must redact pack-asset tokens from printed paths."""
from __future__ import annotations

import asyncio
import contextlib
import io

from aiohttp import web

from service import access
from tests.pack_asset_test_util import SESSION, mint, make_test_app
from aiohttp.test_utils import TestClient, TestServer


async def _noop_put(_request):  # noqa: ANN001
    return web.Response(status=204)


def test_mutate_stdout_redacts_pack_asset_token() -> None:
    from aiohttp import web

    app = make_test_app()
    app.router.add_route("PUT", r"/pack-assets/{token}/{pack_id}/{tail:.+}", _noop_put)
    tok = mint("demo-pack")
    path = access.pack_asset_url(tok, "demo-pack", "module.js")
    buf = io.StringIO()

    async def run() -> None:
        async with TestClient(TestServer(app)) as client:
            with contextlib.redirect_stdout(buf):
                resp = await client.put(
                    path,
                    headers={access.HEADER: SESSION},
                    data=b"x",
                )
            assert resp.status == 204

    asyncio.run(run())
    out = buf.getvalue()
    assert tok not in out
    assert "%3Csandbox-token%3E" in out
