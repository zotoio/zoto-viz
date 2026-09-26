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
from tests.pack_asset_test_util import SESSION, SECRET, mint, new_frame_id, pack_url, pack_url_raw
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

    async def test_encoding_ab_c_not_verified_as_a_bc(self) -> None:
        from service import pack_asset_frames

        frame = new_frame_id()
        reg = pack_asset_frames.registry_for_app(self.server.app)
        reg.register("ab", frame)
        reg.register("a", frame)
        tok = pack_asset_tokens.mint_pack_asset_token(SECRET, "ab", "c", frame)
        row_c = {"id": "c", "has_frontend": True}
        row_bc = {"id": "bc", "has_frontend": True}

        def plugin_row(pid: str):
            if pid == "c":
                return row_c
            if pid == "bc":
                return row_bc
            return None

        with patch.object(plugins, "_plugin_row", plugin_row):
            with patch.object(plugins, "consented", lambda _doc: True):
                with patch.object(plugins, "module_response", lambda _pid: web.Response(text="export {};", content_type="text/javascript")):
                    ok = await self.client.get(
                        pack_url("c", "module.js", token=tok, session_id="ab"),
                        headers={**NULL, access.HEADER: "ab"},
                    )
                    denied = await self.client.get(
                        pack_url("bc", "module.js", token=tok, session_id="a"),
                        headers={**NULL, access.HEADER: "a"},
                    )
        assert ok.status == 200
        assert denied.status == 403

    async def test_revoked_frame_token_denied(self) -> None:
        frame = new_frame_id()
        reg = await self.client.post(
            "/api/pack-assets/frames",
            json={"frameId": frame},
            headers={**HOST, access.HEADER: SESSION},
        )
        assert reg.status == 200
        tok = pack_asset_tokens.mint_pack_asset_token(SECRET, SESSION, "demo-pack", frame)
        row = {"id": "demo-pack", "has_frontend": True}
        unreg = await self.client.delete(
            f"/api/pack-assets/frames/{frame}",
            headers={**HOST, access.HEADER: SESSION},
        )
        assert unreg.status == 200
        with patch.object(plugins, "_plugin_row", lambda pid: row if pid == "demo-pack" else None):
            with patch.object(plugins, "consented", lambda _doc: True):
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
        fe = home / "frontend"
        fe.mkdir()
        secret = fe / "secret.txt"
        secret.write_text("leak", encoding="utf-8")
        row = {
            "id": "traversal-pack",
            "has_frontend": True,
            "file": str(home / "plugin.yml"),
        }
        tails = (
            "../secret.txt",
            "frontend/../../secret.txt",
            "..%2fsecret.txt",
            "%2e%2e%2fsecret.txt",
            "%252e%252e%252fsecret.txt",
            "frontend%2f..%2f..%2fsecret.txt",
            "..\\secret.txt",
            "%5c..%5csecret.txt",
            "//etc/passwd",
        )
        with patch.object(plugins, "_plugin_row", lambda pid: row if pid == "traversal-pack" else None):
            with patch.object(plugins, "consented", lambda _doc: True):
                for tail in tails:
                    resp = await self.client.get(
                        pack_url_raw("traversal-pack", tail),
                        headers={**HOST},
                    )
                    assert resp.status in {403, 404}, tail
                    body = await resp.text()
                    assert "leak" not in body and "root:" not in body, tail

    async def test_traversal_realpath_outside_frontend_root(self) -> None:
        outside = Path(tempfile.mkdtemp())
        leak = outside / "outside-leak.txt"
        leak.write_text("outside-secret", encoding="utf-8")
        home = Path(tempfile.mkdtemp())
        fe = home / "frontend"
        fe.mkdir()
        (fe / "module.js").write_text("export {};", encoding="utf-8")
        try:
            os.symlink(leak, fe / "escape.js")
            os.symlink(outside, fe / "escape-dir")
        except OSError:
            return  # no symlink support in this environment
        row = {"id": "symlink-pack", "has_frontend": True, "file": str(home / "plugin.yml")}
        with patch.object(plugins, "_plugin_row", lambda pid: row if pid == "symlink-pack" else None):
            with patch.object(plugins, "consented", lambda _doc: True):
                for tail in ("escape.js", "escape-dir/outside-leak.txt"):
                    resp = await self.client.get(pack_url_raw("symlink-pack", tail), headers={**HOST})
                    assert resp.status in {403, 404}, tail
                    assert "outside-secret" not in await resp.text()

    async def test_dotfile_under_pack_is_404(self) -> None:
        home = Path(tempfile.mkdtemp())
        fe = home / "frontend"
        fe.mkdir()
        (fe / ".env").write_text("SECRET=leak", encoding="utf-8")
        (fe / "nested").mkdir()
        (fe / "nested" / ".hidden.js").write_text("export {};", encoding="utf-8")
        row = {"id": "dot-pack", "has_frontend": True, "file": str(home / "plugin.yml")}
        with patch.object(plugins, "_plugin_row", lambda pid: row if pid == "dot-pack" else None):
            with patch.object(plugins, "consented", lambda _doc: True):
                for tail in (".env", "nested/.hidden.js", "frontend/.env"):
                    resp = await self.client.get(pack_url_raw("dot-pack", tail), headers={**HOST})
                    assert resp.status == 404, tail
                    assert "SECRET=leak" not in await resp.text()

    async def test_backend_marker_path_is_404(self) -> None:
        home = Path(tempfile.mkdtemp())
        fe = home / "frontend"
        fe.mkdir()
        backend_under_fe = fe / "backend"
        backend_under_fe.mkdir()
        (backend_under_fe / "leak.js").write_text("export const x = 'backend-leak';", encoding="utf-8")
        row = {"id": "backend-pack", "has_frontend": True, "file": str(home / "plugin.yml")}
        with patch.object(plugins, "_plugin_row", lambda pid: row if pid == "backend-pack" else None):
            with patch.object(plugins, "consented", lambda _doc: True):
                resp = await self.client.get(pack_url_raw("backend-pack", "backend/leak.js"), headers={**HOST})
        assert resp.status == 404
        assert "backend-leak" not in await resp.text()

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
