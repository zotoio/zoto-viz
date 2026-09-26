"""Sandbox CSP must not trust injected Host header fragments."""
from __future__ import annotations

from aiohttp.test_utils import AioHTTPTestCase

from tests.pack_asset_test_util import NULL, SESSION, mint, pack_url, test_app


class PackAssetsCspHostTests(AioHTTPTestCase):
    async def get_application(self):
        return test_app()

    async def test_injected_host_fragment_does_not_widen_csp(self) -> None:
        tok = mint("_sandbox")
        evil = "127.0.0.1:7020; connect-src *"
        resp = await self.client.get(
            pack_url("_sandbox", "plugin-sandbox.html", token=tok),
            headers={**NULL, "Host": evil},
        )
        assert resp.status == 403
        csp = resp.headers.get("Content-Security-Policy") or ""
        assert "connect-src *" not in csp
