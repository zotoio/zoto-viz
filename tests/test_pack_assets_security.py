"""Pack-assets security: consent-bound paths, traversal hardening, token hygiene."""
from __future__ import annotations

import io
import contextlib
import os
import tempfile
from pathlib import Path
from unittest.mock import patch

from aiohttp import web
from aiohttp.test_utils import AioHTTPTestCase

from service import access, pack_asset_tokens, plugins
from tests.pack_asset_test_util import SESSION, SECRET, mint, pack_url
from tests.pack_asset_test_util import test_app as make_pack_test_app

HOST = {"Host": "127.0.0.1:7020"}
NULL = {**HOST, "Origin": "null"}
SESSION_B = "other-session-csrf-token-bbb"


class PackAssetsSecurityTests(AioHTTPTestCase):
    async def get_application(self) -> web.Application:
        return make_pack_test_app()

    async def test_valid_token_cannot_fetch_unconsented_pack(self) -> None:
        """Session token does not bypass consent for a different pack id in the path."""
        row_a = {"id": "pack-a", "has_frontend": True, "file": "/fake/a/plugin.yml"}
        with patch.object(plugins, "_plugin_row", lambda pid: row_a if pid == "pack-a" else None):
            with patch.object(plugins, "consented", lambda doc: doc.get("id") == "pack-a"):
                with patch.object(plugins, "module_response", lambda _pid: web.Response(text="export {};", content_type="text/javascript")):
                    ok = await self.client.get(pack_url("pack-a", "module.js"), headers=NULL)
                    denied = await self.client.get(pack_url("pack-b", "module.js"), headers=NULL)
        assert ok.status == 200
        assert denied.status == 403

    async def test_wrong_token_denied_for_any_pack_path(self) -> None:
        row = {"id": "demo-pack", "has_frontend": True}
        with patch.object(plugins, "_plugin_row", lambda pid: row if pid == "demo-pack" else None):
            with patch.object(plugins, "consented", lambda _doc: True):
                with patch.object(plugins, "module_response", lambda _pid: web.Response(text="export {};", content_type="text/javascript")):
                    resp = await self.client.get(
                        pack_url("demo-pack", "module.js", token="totally-wrong-token"),
                        headers=NULL,
                    )
        assert resp.status == 403

    async def test_token_bound_to_session_id(self) -> None:
        row = {"id": "demo-pack", "has_frontend": True}
        tok_a = mint("demo-pack", SESSION)
        with patch.object(plugins, "_plugin_row", lambda pid: row if pid == "demo-pack" else None):
            with patch.object(plugins, "consented", lambda _doc: True):
                with patch.object(plugins, "module_response", lambda _pid: web.Response(text="export {};", content_type="text/javascript")):
                    ok = await self.client.get(
                        pack_url("demo-pack", "module.js", token=tok_a),
                        headers={**NULL, access.HEADER: SESSION},
                    )
                    denied = await self.client.get(
                        pack_url("demo-pack", "module.js", token=tok_a),
                        headers={**NULL, access.HEADER: SESSION_B},
                    )
        assert ok.status == 200
        assert denied.status == 403

    async def test_token_bound_to_pack_id(self) -> None:
        row_x = {"id": "pack-x", "has_frontend": True, "file": "/fake/x/plugin.yml"}
        row_y = {"id": "pack-y", "has_frontend": True, "file": "/fake/y/plugin.yml"}
        tok_x = mint("pack-x", SESSION)

        def row(pid: str):
            if pid == "pack-x":
                return row_x
            if pid == "pack-y":
                return row_y
            return None

        with patch.object(plugins, "_plugin_row", row):
            with patch.object(plugins, "consented", lambda _doc: True):
                with patch.object(plugins, "module_response", lambda _pid: web.Response(text="export {};", content_type="text/javascript")):
                    ok = await self.client.get(pack_url("pack-x", "module.js", token=tok_x), headers=NULL)
                    denied = await self.client.get(pack_url("pack-y", "module.js", token=tok_x), headers=NULL)
        assert ok.status == 200
        assert denied.status == 403

    async def test_expired_token_denied(self) -> None:
        row = {"id": "demo-pack", "has_frontend": True}
        tok = pack_asset_tokens.mint_pack_asset_token(SECRET, SESSION, "demo-pack", ttl_s=60)
        exp = int(tok.split(".", 2)[1])
        with patch.object(plugins, "_plugin_row", lambda pid: row if pid == "demo-pack" else None):
            with patch.object(plugins, "consented", lambda _doc: True):
                with patch.object(plugins, "module_response", lambda _pid: web.Response(text="export {};", content_type="text/javascript")):
                    with patch.object(pack_asset_tokens, "time") as tmock:
                        tmock.time.return_value = exp + 5
                        resp = await self.client.get(pack_url("demo-pack", "module.js", token=tok), headers=NULL)
        assert resp.status == 403

    async def test_non_ascii_token_rejected(self) -> None:
        row = {"id": "demo-pack", "has_frontend": True}
        tok = mint("demo-pack") + "\u00ff"
        with patch.object(plugins, "_plugin_row", lambda pid: row if pid == "demo-pack" else None):
            with patch.object(plugins, "consented", lambda _doc: True):
                resp = await self.client.get(pack_url("demo-pack", "module.js", token=tok), headers=NULL)
        assert resp.status == 403

    async def test_pack_id_dotdot_rejected(self) -> None:
        tok = mint("demo-pack")
        resp = await self.client.get(pack_url("..", "module.js", token=tok), headers={**HOST})
        assert resp.status == 404

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
                        pack_url("traversal-pack", tail),
                        headers={**HOST},
                    )
                    assert resp.status in {403, 404}, tail

    async def test_traversal_realpath_outside_frontend_root(self) -> None:
        outside = Path(tempfile.mkdtemp())
        leak = outside / "outside-leak.txt"
        leak.write_text("outside", encoding="utf-8")
        home = Path(tempfile.mkdtemp())
        fe = home / "frontend"
        fe.mkdir()
        (fe / "module.js").write_text("export {};", encoding="utf-8")
        try:
            os.symlink(leak, fe / "escape.js")
        except OSError:
            return  # no symlink support in this environment
        row = {"id": "symlink-pack", "has_frontend": True, "file": str(home / "plugin.yml")}
        with patch.object(plugins, "_plugin_row", lambda pid: row if pid == "symlink-pack" else None):
            with patch.object(plugins, "consented", lambda _doc: True):
                resp = await self.client.get(pack_url("symlink-pack", "escape.js"), headers={**HOST})
        assert resp.status == 404

    async def test_dotfile_under_pack_is_404(self) -> None:
        home = Path(tempfile.mkdtemp())
        fe = home / "frontend"
        fe.mkdir()
        (fe / ".hidden.js").write_text("export {};", encoding="utf-8")
        row = {"id": "dot-pack", "has_frontend": True, "file": str(home / "plugin.yml")}
        with patch.object(plugins, "_plugin_row", lambda pid: row if pid == "dot-pack" else None):
            with patch.object(plugins, "consented", lambda _doc: True):
                resp = await self.client.get(pack_url("dot-pack", ".hidden.js"), headers={**HOST})
        assert resp.status == 404

    async def test_backend_marker_path_is_404(self) -> None:
        home = Path(tempfile.mkdtemp())
        backend = home / "backend"
        backend.mkdir()
        (backend / "service.py").write_text("x = 1\n", encoding="utf-8")
        row = {"id": "backend-pack", "has_frontend": True, "file": str(home / "plugin.yml")}
        with patch.object(plugins, "_plugin_row", lambda pid: row if pid == "backend-pack" else None):
            with patch.object(plugins, "consented", lambda _doc: True):
                resp = await self.client.get(pack_url("backend-pack", "backend/service.py"), headers={**HOST})
        assert resp.status == 404

    async def test_sandbox_fixture_multi_serves_sibling_files(self) -> None:
        """Multi-file pack: module.js stays ESM; helper and JSON are separate GETs (relative imports)."""
        from service import plugins as plugins_mod

        plugins_mod.reset_bundles()
        home = plugins_mod.src_plugin_home("sandbox-fixture-multi")
        assert home is not None
        row = next(p for p in plugins_mod.scan()["plugins"] if p["id"] == "sandbox-fixture-multi")
        with patch.object(plugins, "_plugin_row", lambda pid: row if pid == "sandbox-fixture-multi" else None):
            with patch.object(plugins, "consented", lambda _doc: True):
                mod = await self.client.get(pack_url("sandbox-fixture-multi", "module.js"), headers=NULL)
                helper = await self.client.get(pack_url("sandbox-fixture-multi", "helper.js"), headers=NULL)
                fixture = await self.client.get(pack_url("sandbox-fixture-multi", "fixture.json"), headers=NULL)
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
        tok = mint("demo-pack")
        path = pack_url("demo-pack", "module.js", token=tok)
        with patch.object(plugins, "_plugin_row", lambda pid: row if pid == "demo-pack" else None):
            with patch.object(plugins, "consented", lambda _doc: True):
                with patch.object(plugins, "module_response", lambda _pid: web.Response(text="export {};", content_type="text/javascript")):
                    with contextlib.redirect_stdout(buf):
                        await self.client.get(path, headers={**HOST})
        req = type(
            "Req",
            (),
            {
                "remote": "127.0.0.1",
                "method": "GET",
                "path": path.split("?", 1)[0],
                "path_qs": path,
                "version": type("V", (), {"major": 1, "minor": 1})(),
            },
        )()
        line = access.RedactingAccessLogger._format_r(req, web.Response(text="ok"), 0.001)
        assert tok not in line
        assert access.SANDBOX_TOKEN_REDACT in line
