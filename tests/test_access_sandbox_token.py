from aiohttp import web
from aiohttp.test_utils import AioHTTPTestCase

from service import access

HOST = {"Host": "127.0.0.1:7020"}
NULL = {**HOST, "Origin": "null"}
SAT = "test-sandbox-asset-token-32chars-min"


def _sat_q(token: str = SAT) -> str:
    return f"?{access.SANDBOX_ASSET_QUERY}={token}"


class SandboxAssetTokenOriginTests(AioHTTPTestCase):
    """Revert proof: restore bare ``Origin: null`` allowlist → these tests fail (403/200 flip)."""

    async def get_application(self) -> web.Application:
        async def module(_: web.Request) -> web.Response:
            return web.Response(text="export {};", content_type="text/javascript")

        async def profiles(_: web.Request) -> web.Response:
            return web.json_response({"profiles": []})

        async def sources(_: web.Request) -> web.Response:
            return web.json_response({"sources": []})

        async def install(_: web.Request) -> web.Response:
            return web.json_response({"installed": True})

        async def sandbox(_: web.Request) -> web.Response:
            return web.Response(text="<html></html>", content_type="text/html")

        app = web.Application(middlewares=[access.middleware])
        app["csrf"] = "token-aaa"
        app["sandbox_asset_token"] = SAT
        app["insecure_lan"] = False
        app.router.add_get("/api/plugins/{id}/module.js", module)
        app.router.add_get("/api/profiles", profiles)
        app.router.add_put("/api/plugins/{id}/consent", profiles)
        app.router.add_put("/api/sources", sources)
        app.router.add_post("/api/ai/plugin/local", install)
        app.router.add_get("/assets/plugin-sandbox-deadbeef.js", sandbox)
        return app

    async def test_null_origin_module_js_with_valid_token_when_consented(self) -> None:
        """Revert: drop token gate → still 200; revert consent → 200 without review should fail."""
        from unittest.mock import patch

        from service import plugins

        row = {"id": "demo-pack", "has_frontend": True, "version": 1}
        with patch.object(plugins, "_plugin_row", lambda pid: row if pid == "demo-pack" else None):
            with patch.object(plugins, "consented", lambda doc: doc.get("id") == "demo-pack"):
                resp = await self.client.get(
                    f"/api/plugins/demo-pack/module.js{_sat_q()}",
                    headers=NULL,
                )
        assert resp.status == 200
        assert resp.headers.get("Access-Control-Allow-Origin") == "null"

    async def test_null_origin_module_js_denied_without_token(self) -> None:
        """Revert: bare null allowlist → 200 (should stay 403)."""
        from unittest.mock import patch

        from service import plugins

        row = {"id": "demo-pack", "has_frontend": True, "version": 1}
        with patch.object(plugins, "_plugin_row", lambda pid: row if pid == "demo-pack" else None):
            with patch.object(plugins, "consented", lambda doc: doc.get("id") == "demo-pack"):
                resp = await self.client.get(
                    "/api/plugins/demo-pack/module.js",
                    headers=NULL,
                )
        assert resp.status == 403

    async def test_null_origin_module_js_denied_with_wrong_token(self) -> None:
        """Revert: compare_digest bypass → wrong token would 200."""
        from unittest.mock import patch

        from service import plugins

        row = {"id": "demo-pack", "has_frontend": True, "version": 1}
        with patch.object(plugins, "_plugin_row", lambda pid: row if pid == "demo-pack" else None):
            with patch.object(plugins, "consented", lambda doc: doc.get("id") == "demo-pack"):
                resp = await self.client.get(
                    f"/api/plugins/demo-pack/module.js{_sat_q('wrong-token')}",
                    headers=NULL,
                )
        assert resp.status == 403

    async def test_null_origin_module_js_denied_without_consent_even_with_token(self) -> None:
        from unittest.mock import patch

        from service import plugins

        row = {"id": "secret", "has_frontend": True, "version": 1}
        with patch.object(plugins, "_plugin_row", lambda pid: row if pid == "secret" else None):
            with patch.object(plugins, "consented", lambda _doc: False):
                resp = await self.client.get(
                    f"/api/plugins/secret/module.js{_sat_q()}",
                    headers=NULL,
                )
        assert resp.status == 403

    async def test_null_origin_put_denied_even_with_valid_token(self) -> None:
        """Revert: allow null mutations with token → would not 403."""
        resp = await self.client.put(
            f"/api/plugins/demo/consent{_sat_q()}",
            headers={**NULL, access.HEADER: "token-aaa"},
        )
        assert resp.status == 403

    async def test_null_origin_profiles_denied_with_valid_token(self) -> None:
        resp = await self.client.get(
            f"/api/profiles{_sat_q()}",
            headers=NULL,
        )
        assert resp.status == 403

    async def test_null_origin_sources_put_denied_with_valid_token(self) -> None:
        resp = await self.client.put(
            f"/api/sources{_sat_q()}",
            headers={**NULL, access.HEADER: "token-aaa"},
        )
        assert resp.status == 403

    async def test_null_origin_install_denied_with_valid_token(self) -> None:
        resp = await self.client.post(
            f"/api/ai/plugin/local{_sat_q()}",
            headers={**NULL, access.HEADER: "token-aaa"},
        )
        assert resp.status == 403

    async def test_null_origin_bootstrap_js_with_valid_token(self) -> None:
        resp = await self.client.get(
            f"/assets/plugin-sandbox-deadbeef.js{_sat_q()}",
            headers=NULL,
        )
        assert resp.status == 200
        assert resp.headers.get("Access-Control-Allow-Origin") == "null"
