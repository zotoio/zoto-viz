"""Sandbox bootstrap CSP: token-scoped asset sources and locked-down defaults."""
from __future__ import annotations

import re
import tempfile
from pathlib import Path

from aiohttp.test_utils import AioHTTPTestCase

from service import monitor, pack_assets
from tests.pack_asset_test_util import HOST, NULL, SESSION, mint, pack_url, make_test_app

_DIST = Path(tempfile.mkdtemp())
_ASSETS = _DIST / "assets"
_ASSETS.mkdir(parents=True)
(_DIST / "plugin-sandbox.html").write_text(
    '<html><head></head><body><script src="/assets/plugin-sandbox-abc123.js"></script></body></html>',
    encoding="utf-8",
)
(_ASSETS / "plugin-sandbox-abc123.js").write_text("// sandbox bootstrap stub", encoding="utf-8")


class PackAssetsSandboxCspTests(AioHTTPTestCase):
    @classmethod
    def setUpClass(cls) -> None:
        super().setUpClass()
        cls._orig = monitor.WEB_DIST
        monitor.WEB_DIST = _DIST

    @classmethod
    def tearDownClass(cls) -> None:
        monitor.WEB_DIST = cls._orig
        super().tearDownClass()

    async def get_application(self):
        return make_test_app()

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
        assert csp.count("'self' blob:") == 0
        assert "img-src data:" not in csp

    async def test_sandbox_bootstrap_js_csp_matches_html(self) -> None:
        tok = mint("_sandbox")
        html = await self.client.get(pack_url("_sandbox", "plugin-sandbox.html", token=tok), headers=NULL)
        assert html.status == 200
        body = await html.text()
        m = re.search(r"plugin-sandbox-abc123\.js", body)
        assert m, body
        js_name = m.group(0)
        js = await self.client.get(pack_url("_sandbox", js_name, token=tok), headers=NULL)
        assert js.status == 200, await js.text()
        js_csp = self._csp(js)
        assert len(js_csp) == len(self._csp(html))

    def test_sandbox_csp_builder_unit(self) -> None:
        class _Req:
            scheme = "http"
            headers = {"Host": "192.168.1.50:7020"}
            app = {"insecure_lan": True}
            validated_http_origin = "http://192.168.1.50:7020"

            def get(self, key: str, default=None):  # noqa: ANN001
                if key == "validated_http_origin":
                    return self.validated_http_origin
                return default

        csp = pack_assets.sandbox_csp_for_token(_Req(), "sess-tok")
        assert "http://192.168.1.50:7020/pack-assets/sess-tok/" in csp
