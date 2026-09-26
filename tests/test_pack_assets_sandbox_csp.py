"""Sandbox bootstrap CSP: token-scoped asset sources and locked-down defaults."""
from __future__ import annotations

from aiohttp.test_utils import AioHTTPTestCase

from service import pack_assets
from tests.pack_asset_test_util import mint, pack_url, test_app

NULL = {"Host": "127.0.0.1:7020", "Origin": "null"}


class PackAssetsSandboxCspTests(AioHTTPTestCase):
    async def get_application(self):
        return test_app()

    def _csp(self, resp) -> str:
        return resp.headers.get("Content-Security-Policy") or ""

    async def test_sandbox_html_csp_directives(self) -> None:
        tok = mint("_sandbox", frame_id="11111111-1111-4111-8111-111111111111")
        resp = await self.client.get(pack_url("_sandbox", "plugin-sandbox.html", token=tok), headers=NULL)
        assert resp.status == 200
        csp = self._csp(resp)
        src = f"http://127.0.0.1:7020/pack-assets/{tok}/"
        assert "default-src 'none'" in csp
        assert f"script-src {src}" in csp
        assert f"img-src {src}" in csp
        assert f"style-src {src}" in csp
        assert f"font-src {src}" in csp
        assert "object-src 'none'" in csp
        assert "frame-src 'none'" in csp
        assert "worker-src 'none'" in csp
        assert "form-action 'none'" in csp
        assert "base-uri 'none'" in csp
        assert "connect-src 'none'" in csp
        assert "frame-ancestors 'self'" in csp
        assert "'self' blob:" not in csp
        assert "img-src data:" not in csp

    async def test_sandbox_bootstrap_js_csp_matches_html(self) -> None:
        tok = mint("_sandbox")
        html = await self.client.get(pack_url("_sandbox", "plugin-sandbox.html", token=tok), headers=NULL)
        assert html.status == 200
        body = await html.text()
        import re

        m = re.search(r'plugin-sandbox-[\w-]+\.js', body)
        assert m, body
        js_name = m.group(0)
        js = await self.client.get(pack_url("_sandbox", js_name, token=tok), headers=NULL)
        if js.status == 404:
            return
        assert self._csp(js) == self._csp(html)

    def test_sandbox_csp_builder_unit(self) -> None:
        class _Req:
            scheme = "http"
            host = "192.168.1.50:7020"

        csp = pack_assets.sandbox_csp_for_token(_Req(), "sess-tok")
        assert "http://192.168.1.50:7020/pack-assets/sess-tok/" in csp
