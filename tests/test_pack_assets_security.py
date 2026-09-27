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
from tests.pack_asset_test_util import (
    DEFAULT_FRAME,
    SESSION,
    SECRET,
    mint,
    new_frame_id,
    pack_url,
    pack_url_raw,
    make_test_app as make_pack_test_app,
)

HOST = {"Host": "127.0.0.1:7020"}
NULL = {**HOST, "Origin": "null", access.HEADER: SESSION}
SESSION_B = "other-session-csrf-token-bbb"


async def assert_token_invalid(resp) -> None:
    assert resp.status == 401
    assert resp.headers.get("X-Content-Type-Options") == "nosniff"
    body = await resp.json()
    assert body == {"error": "token_invalid"}


class PackAssetsSecurityTests(AioHTTPTestCase):
    async def get_application(self) -> web.Application:
        return make_pack_test_app()

    async def test_consented_module_js_is_no_store(self) -> None:
        row = {"id": "demo-pack", "has_frontend": True}
        with patch.object(plugins, "_plugin_row", lambda pid: row if pid == "demo-pack" else None):
            with patch.object(plugins, "consented", lambda _doc: True):
                with patch.object(plugins, "module_response", lambda _pid: web.Response(text="export {};", content_type="text/javascript")):
                    resp = await self.client.get(pack_url("demo-pack", "module.js"), headers=NULL)
        assert resp.status == 200
        assert resp.headers.get("Cache-Control") == "no-store"

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
        await assert_token_invalid(resp)

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
        await assert_token_invalid(denied)

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
        await assert_token_invalid(denied)

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
        await assert_token_invalid(denied)

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
        await assert_token_invalid(resp)

    async def test_non_ascii_token_rejected(self) -> None:
        row = {"id": "demo-pack", "has_frontend": True}
        tok = mint("demo-pack") + "\u00ff"
        with patch.object(plugins, "_plugin_row", lambda pid: row if pid == "demo-pack" else None):
            with patch.object(plugins, "consented", lambda _doc: True):
                resp = await self.client.get(pack_url("demo-pack", "module.js", token=tok), headers=NULL)
        await assert_token_invalid(resp)

    async def test_non_ascii_pack_id_in_path_rejected(self) -> None:
        bad_id = "dem\u00f6-pack"
        row = {"id": bad_id, "has_frontend": True}
        tok = pack_asset_tokens.mint_pack_asset_token(SECRET, SESSION, bad_id, DEFAULT_FRAME)
        with patch.object(plugins, "_plugin_row", lambda pid: row if pid == bad_id else None):
            with patch.object(plugins, "consented", lambda _doc: True):
                with patch.object(plugins, "module_response", lambda _pid: web.Response(text="export {};", content_type="text/javascript")):
                    resp = await self.client.get(
                        pack_url_raw(bad_id, "module.js", token=tok),
                        headers=NULL,
                    )
        assert resp.status == 404

    async def test_pack_asset_accepts_csrf_cookie_without_header(self) -> None:
        row = {"id": "demo-pack", "has_frontend": True}
        tok = mint("demo-pack", SESSION)
        cookie_headers = {
            **HOST,
            "Origin": "null",
            "Cookie": f"{access.COOKIE}={SESSION}",
        }
        with patch.object(plugins, "_plugin_row", lambda pid: row if pid == "demo-pack" else None):
            with patch.object(plugins, "consented", lambda _doc: True):
                with patch.object(plugins, "module_response", lambda _pid: web.Response(text="export {};", content_type="text/javascript")):
                    resp = await self.client.get(
                        pack_url("demo-pack", "module.js", token=tok),
                        headers=cookie_headers,
                    )
        assert resp.status == 200

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
        tails: tuple[tuple[str, int], ...] = (
            ("../secret.txt", 403),
            ("frontend/../../secret.txt", 403),
            ("..%2fsecret.txt", 404),
            ("%2e%2e%2fsecret.txt", 404),
            ("%252e%252e%252fsecret.txt", 404),
            ("frontend%2f..%2f..%2fsecret.txt", 404),
            ("..\\secret.txt", 404),
            ("%5c..%5csecret.txt", 404),
            ("//etc/passwd", 404),
        )
        with patch.object(plugins, "_plugin_row", lambda pid: row if pid == "traversal-pack" else None):
            with patch.object(plugins, "consented", lambda _doc: True):
                for tail, want_status in tails:
                    resp = await self.client.get(
                        pack_url_raw("traversal-pack", tail),
                        headers=NULL,
                    )
                    assert resp.status == want_status
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
                    resp = await self.client.get(pack_url_raw("symlink-pack", tail), headers=NULL)
                    assert resp.status == 404
                    assert "outside-secret" not in await resp.text()

    async def test_dotfile_under_pack_is_403(self) -> None:
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
                    resp = await self.client.get(pack_url_raw("dot-pack", tail), headers=NULL)
                    assert resp.status == 403
                    assert (await resp.json()) == {"error": "forbidden path"}
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
                resp = await self.client.get(pack_url_raw("backend-pack", "backend/leak.js"), headers=NULL)
        assert resp.status == 404
        assert "backend-leak" not in await resp.text()

    async def test_sandbox_fixture_multi_serves_sibling_files(self) -> None:
        """Multi-file pack: module.js stays ESM; helper and JSON are separate GETs (relative imports)."""
        home = Path(tempfile.mkdtemp())
        fe = home / "frontend"
        fe.mkdir()
        (home / "plugin.yml").write_text(
            "id: sandbox-fixture-multi\nfrontend:\n  entry: frontend/module.js\n  bundle: false\n",
            encoding="utf-8",
        )
        (fe / "module.js").write_text('import "./helper.js";\nexport {};\n', encoding="utf-8")
        (fe / "helper.js").write_text("export function pulse() { return 1; }\n", encoding="utf-8")
        (fe / "fixture.json").write_text('{"bright": true}\n', encoding="utf-8")
        row = {
            "id": "sandbox-fixture-multi",
            "has_frontend": True,
            "file": str(home / "plugin.yml"),
            "frontend": {"entry": "frontend/module.js", "bundle": False},
        }
        with patch.object(plugins, "_plugin_row", lambda pid: row if pid == "sandbox-fixture-multi" else None):
            with patch.object(plugins, "consented", lambda _doc: True):
                plugins.reset_bundles()
                plugins.compile_typescript(row, home / "plugin.yml", None)
                mod = await self.client.get(pack_url("sandbox-fixture-multi", "module.js"), headers=NULL)
                helper = await self.client.get(pack_url("sandbox-fixture-multi", "helper.js"), headers=NULL)
                fixture = await self.client.get(pack_url("sandbox-fixture-multi", "fixture.json"), headers=NULL)
        assert mod.status == 200
        assert helper.status == 200
        assert fixture.status == 200
        body = await mod.text()
        assert body.count("./helper.js") == 1
        assert "export function pulse" in (await helper.text())
        assert "bright" in (await fixture.text())

    async def test_non_frontend_python_under_frontend_is_404(self) -> None:
        home = Path(tempfile.mkdtemp())
        fe = home / "frontend"
        fe.mkdir()
        (fe / "x.py").write_text("print('leak')\n", encoding="utf-8")
        row = {"id": "demo-pack", "has_frontend": True, "file": str(home / "plugin.yml")}
        with patch.object(plugins, "_plugin_row", lambda pid: row if pid == "demo-pack" else None):
            with patch.object(plugins, "consented", lambda _doc: True):
                resp = await self.client.get(pack_url("demo-pack", "x.py"), headers=NULL)
        assert resp.status == 404

    async def test_token_mint_denied_for_unconsented_pack(self) -> None:
        row = {"id": "secret-pack", "has_frontend": True}
        with patch.object(plugins, "_plugin_row", lambda pid: row if pid == "secret-pack" else None):
            with patch.object(plugins, "consented", lambda _doc: False):
                resp = await self.client.post(
                    "/api/pack-assets/token/secret-pack",
                    headers={**HOST, access.HEADER: SESSION},
                    json={"frameId": DEFAULT_FRAME},
                )
        assert resp.status == 403
        assert (await resp.json()) == {"error": "forbidden"}

    async def test_token_mint_denied_when_frame_not_registered(self) -> None:
        row = {"id": "demo-pack", "has_frontend": True}
        frame = new_frame_id()
        with patch.object(plugins, "_plugin_row", lambda pid: row if pid == "demo-pack" else None):
            with patch.object(plugins, "consented", lambda _doc: True):
                resp = await self.client.post(
                    "/api/pack-assets/token/demo-pack",
                    headers={**HOST, access.HEADER: SESSION},
                    json={"frameId": frame},
                )
        assert resp.status == 403
        assert (await resp.json()) == {"error": "frame not registered"}
