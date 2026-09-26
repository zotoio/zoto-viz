"""Pack-assets security: consent-bound paths, traversal hardening, token hygiene."""
from __future__ import annotations

import io
import contextlib
import tempfile
from pathlib import Path
from unittest.mock import patch

from aiohttp import web
from aiohttp.test_utils import AioHTTPTestCase

from service import access, pack_assets, plugins

HOST = {"Host": "127.0.0.1:7020"}
NULL = {**HOST, "Origin": "null"}
SAT = "test-sandbox-asset-token-32chars-min"


def _pack_url(pack_id: str, tail: str, token: str = SAT) -> str:
    return access.pack_asset_url(token, pack_id, *tail.split("/"))


class PackAssetsSecurityTests(AioHTTPTestCase):
    async def get_application(self) -> web.Application:
        app = web.Application(middlewares=[access.middleware])
        app["csrf"] = "token-aaa"
        app["sandbox_asset_token"] = SAT
        app["insecure_lan"] = False
        app.router.add_get(r"/pack-assets/{token}/{pack_id}/{tail:.+}", pack_assets.api_pack_assets)
        return app

    async def test_valid_token_cannot_fetch_unconsented_pack(self) -> None:
        """Session token does not bypass consent for a different pack id in the path."""
        row_a = {"id": "pack-a", "has_frontend": True, "file": "/fake/a/plugin.yml"}
        with patch.object(plugins, "_plugin_row", lambda pid: row_a if pid == "pack-a" else None):
            with patch.object(plugins, "consented", lambda doc: doc.get("id") == "pack-a"):
                with patch.object(plugins, "module_response", lambda _pid: web.Response(text="export {};", content_type="text/javascript")):
                    ok = await self.client.get(_pack_url("pack-a", "module.js"), headers=NULL)
                    denied = await self.client.get(_pack_url("pack-b", "module.js"), headers=NULL)
        assert ok.status == 200
        assert denied.status == 403

    async def test_wrong_token_denied_for_any_pack_path(self) -> None:
        row = {"id": "demo-pack", "has_frontend": True}
        with patch.object(plugins, "_plugin_row", lambda pid: row if pid == "demo-pack" else None):
            with patch.object(plugins, "consented", lambda _doc: True):
                with patch.object(plugins, "module_response", lambda _pid: web.Response(text="export {};", content_type="text/javascript")):
                    resp = await self.client.get(
                        _pack_url("demo-pack", "module.js", token="totally-wrong-token"),
                        headers=NULL,
                    )
        assert resp.status == 403

    async def test_path_traversal_dotdot_and_encoded(self) -> None:
        home = Path(tempfile.mkdtemp())
        (home / "frontend").mkdir()
        secret = home / "frontend" / "secret.txt"
        secret.write_text("leak", encoding="utf-8")
        row = {
            "id": "traversal-pack",
            "has_frontend": True,
            "file": str(home / "plugin.yml"),
        }
        with patch.object(plugins, "_plugin_row", lambda pid: row if pid == "traversal-pack" else None):
            with patch.object(plugins, "consented", lambda _doc: True):
                for tail in ("../secret.txt", "frontend/../../secret.txt", "..%2fsecret.txt", "frontend%2f..%2f..%2fsecret.txt"):
                    resp = await self.client.get(
                        _pack_url("traversal-pack", tail),
                        headers={**HOST},
                    )
                    assert resp.status in {403, 404}, tail

    async def test_sandbox_fixture_multi_serves_sibling_files(self) -> None:
        """Multi-file pack: module.js stays ESM; helper and JSON are separate GETs (relative imports)."""
        from service import plugins as plugins_mod

        plugins_mod.reset_bundles()
        home = plugins_mod.src_plugin_home("sandbox-fixture-multi")
        assert home is not None
        row = next(p for p in plugins_mod.scan()["plugins"] if p["id"] == "sandbox-fixture-multi")
        with patch.object(plugins, "_plugin_row", lambda pid: row if pid == "sandbox-fixture-multi" else None):
            with patch.object(plugins, "consented", lambda _doc: True):
                mod = await self.client.get(_pack_url("sandbox-fixture-multi", "module.js"), headers=NULL)
                helper = await self.client.get(_pack_url("sandbox-fixture-multi", "helper.js"), headers=NULL)
                fixture = await self.client.get(_pack_url("sandbox-fixture-multi", "fixture.json"), headers=NULL)
        assert mod.status == 200
        assert helper.status == 200
        assert fixture.status == 200
        body = await mod.text()
        assert "./helper.js" in body
        assert "export function pulse" in (await helper.text())
        assert "bright" in (await fixture.text())

    async def test_token_absent_from_access_log_line(self) -> None:
        row = {"id": "demo-pack", "has_frontend": True}
        buf = io.StringIO()
        log_fn = access.sandbox_access_log(self.server.app)
        path = _pack_url("demo-pack", "module.js")
        with patch.object(plugins, "_plugin_row", lambda pid: row if pid == "demo-pack" else None):
            with patch.object(plugins, "consented", lambda _doc: True):
                with patch.object(plugins, "module_response", lambda _pid: web.Response(text="export {};", content_type="text/javascript")):
                    with contextlib.redirect_stdout(buf):
                        await self.client.get(path, headers={**HOST})
                        log_fn(
                            type("Req", (), {"remote": "127.0.0.1", "method": "GET", "path_qs": path})(),
                            web.Response(text="ok"),
                            0.001,
                        )
        assert SAT not in buf.getvalue()
