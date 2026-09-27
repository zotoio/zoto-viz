from __future__ import annotations

import tempfile
from pathlib import Path
from unittest.mock import patch

from aiohttp import web
from aiohttp.test_utils import AioHTTPTestCase

from service import access, pack_assets, plugins
from tests.pack_asset_test_util import SESSION, mint, pack_url
from tests.pack_asset_test_util import make_test_app as make_pack_test_app

HOST = {"Host": "127.0.0.1:7020"}
NULL = {**HOST, "Origin": "null", access.HEADER: SESSION}


class SandboxAssetTokenOriginTests(AioHTTPTestCase):
    """Revert proof: restore bare ``Origin: null`` allowlist → these tests fail (403/200 flip)."""

    async def get_application(self) -> web.Application:
        async def profiles(_: web.Request) -> web.Response:
            return web.json_response({"profiles": []})

        async def sources(_: web.Request) -> web.Response:
            return web.json_response({"sources": []})

        async def install(_: web.Request) -> web.Response:
            return web.json_response({"installed": True})

        app = make_pack_test_app()
        app.router.add_get("/api/profiles", profiles)
        app.router.add_put("/api/plugins/{id}/consent", profiles)
        app.router.add_put("/api/sources", sources)
        app.router.add_post("/api/ai/plugin/local", install)
        return app

    async def test_null_origin_module_js_with_valid_token_when_consented(self) -> None:
        row = {"id": "demo-pack", "has_frontend": True, "version": 1}
        with patch.object(plugins, "_plugin_row", lambda pid: row if pid == "demo-pack" else None):
            with patch.object(plugins, "consented", lambda doc: doc.get("id") == "demo-pack"):
                with patch.object(plugins, "module_response", lambda _pid: web.Response(text="export {};", content_type="text/javascript")):
                    resp = await self.client.get(
                        pack_url("demo-pack", "module.js"),
                        headers=NULL,
                    )
        assert resp.status == 200
        assert resp.headers.get("Access-Control-Allow-Origin") == "null"
        assert resp.headers.get("Referrer-Policy") == "no-referrer"

    async def test_null_origin_module_js_denied_without_token(self) -> None:
        row = {"id": "demo-pack", "has_frontend": True, "version": 1}
        with patch.object(plugins, "_plugin_row", lambda pid: row if pid == "demo-pack" else None):
            with patch.object(plugins, "consented", lambda doc: doc.get("id") == "demo-pack"):
                resp = await self.client.get(
                    "/pack-assets//demo-pack/module.js",
                    headers=NULL,
                )
        assert resp.status == 403

    async def test_null_origin_module_js_denied_with_wrong_token(self) -> None:
        row = {"id": "demo-pack", "has_frontend": True, "version": 1}
        with patch.object(plugins, "_plugin_row", lambda pid: row if pid == "demo-pack" else None):
            with patch.object(plugins, "consented", lambda doc: doc.get("id") == "demo-pack"):
                resp = await self.client.get(
                    pack_url("demo-pack", "module.js", token="wrong-token"),
                    headers=NULL,
                )
        assert resp.status == 401
        body = await resp.json()
        assert body == {"error": "token_invalid"}

    async def test_null_origin_module_js_denied_without_consent_even_with_token(self) -> None:
        row = {"id": "secret", "has_frontend": True, "version": 1}
        with patch.object(plugins, "_plugin_row", lambda pid: row if pid == "secret" else None):
            with patch.object(plugins, "consented", lambda _doc: False):
                resp = await self.client.get(
                    pack_url("secret", "module.js"),
                    headers=NULL,
                )
        assert resp.status == 403

    async def test_null_origin_put_denied_even_with_valid_token(self) -> None:
        resp = await self.client.put(
            "/api/plugins/demo/consent?ignored=1",
            headers={**NULL, access.HEADER: SESSION},
        )
        assert resp.status == 403

    async def test_null_origin_profiles_denied_with_valid_token(self) -> None:
        resp = await self.client.get(
            "/api/profiles?ignored=1",
            headers=NULL,
        )
        assert resp.status == 403

    async def test_null_origin_sources_put_denied_with_valid_token(self) -> None:
        resp = await self.client.put(
            "/api/sources?ignored=1",
            headers={**NULL, access.HEADER: SESSION},
        )
        assert resp.status == 403

    async def test_null_origin_install_denied_with_valid_token(self) -> None:
        resp = await self.client.post(
            "/api/ai/plugin/local?ignored=1",
            headers={**NULL, access.HEADER: SESSION},
        )
        assert resp.status == 403

    async def test_sandbox_bootstrap_and_chunks_gate_via_path_not_sat_query(self) -> None:
        """Bootstrap html and chunk imports must use /pack-assets/<token>/…, not ?sat= query params."""
        js_name = "plugin-sandbox-deadbeef.js"
        helper = "preload-helper-cafe1234.js"
        tok = mint("_sandbox")
        with tempfile.TemporaryDirectory() as tmp:
            dist = Path(tmp)
            dist.joinpath("plugin-sandbox.html").write_text(
                f'<html><script type="module" src="/assets/{js_name}"></script></html>',
                encoding="utf-8",
            )
            assets = dist / "assets"
            assets.mkdir()
            (assets / js_name).write_text(f'import "./{helper}";\nexport {{}};\n', encoding="utf-8")
            (assets / helper).write_text("// preload", encoding="utf-8")
            with patch.object(pack_assets, "WEB_DIST", dist):
                html = await self.client.get(pack_url("_sandbox", "plugin-sandbox.html"), headers=NULL)
                chunk = await self.client.get(pack_url("_sandbox", js_name), headers=NULL)
        assert html.status == 200
        assert chunk.status == 200
        body_html = await html.text()
        body_js = await chunk.text()
        assert body_html.count("?sat=") == 0
        assert body_html.count("&sat=") == 0
        assert f"/pack-assets/{tok}/_sandbox/" in body_html
        assert "?sat=" not in body_js and "&sat=" not in body_js
        assert f"./{helper}" in body_js

    async def test_null_origin_bootstrap_js_with_valid_token(self) -> None:
        js_name = "plugin-sandbox-deadbeef.js"
        with tempfile.TemporaryDirectory() as tmp:
            dist = Path(tmp)
            assets = dist / "assets"
            assets.mkdir()
            (assets / js_name).write_text("// smoke", encoding="utf-8")
            with patch.object(pack_assets, "WEB_DIST", dist):
                resp = await self.client.get(
                    pack_url("_sandbox", js_name),
                    headers=NULL,
                )
        assert resp.status == 200
        assert resp.headers.get("Access-Control-Allow-Origin") == "null"
        assert resp.headers.get("Referrer-Policy") == "no-referrer"

    def test_mutate_log_path_redacts_pack_asset_token(self) -> None:
        tok = mint("demo-pack")
        path = pack_url("demo-pack", "module.js", token=tok)
        safe = access.redact_request_path(path, tok)
        assert safe.count(tok) == 0
        assert "%3Csandbox-token%3E" in safe
