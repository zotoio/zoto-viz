"""/pack-assets 4xx responses are logged with status and error (401 vs 403), never the token."""
from __future__ import annotations

import contextlib
import io
from unittest.mock import patch

from aiohttp import web
from aiohttp.test_utils import AioHTTPTestCase

from service import access, plugins
from tests.pack_asset_test_util import SESSION, make_test_app, pack_url

HOST = {"Host": "127.0.0.1:7020"}
NULL = {**HOST, "Origin": "null", access.HEADER: SESSION}


def _module(_pid: str) -> web.Response:
    return web.Response(text="export {};", content_type="text/javascript")


class PackAssets4xxLogTests(AioHTTPTestCase):
    async def get_application(self) -> web.Application:
        return make_test_app()

    async def _get(self, url: str) -> tuple[int, str]:
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            resp = await self.client.get(url, headers=NULL)
        return resp.status, out.getvalue()

    async def test_dead_frame_token_logs_401_token_invalid_without_token(self) -> None:
        row = {"id": "koi-pond", "has_frontend": True}
        with patch.object(plugins, "_plugin_row", lambda pid: row if pid == "koi-pond" else None):
            with patch.object(plugins, "consented", lambda _doc: True):
                with patch.object(plugins, "module_response", _module):
                    status, log = await self._get(pack_url("koi-pond", "module.js", token="dead-frame-token-xyz"))
        assert status == 401
        assert "pack-assets GET" in log
        assert "-> 401 error=token_invalid" in log
        assert "origin=null" in log
        assert "dead-frame-token-xyz" not in log
        assert access.SANDBOX_TOKEN_REDACT in log

    async def test_unconsented_pack_logs_403_forbidden_origin_without_token(self) -> None:
        with patch.object(plugins, "_plugin_row", lambda pid: {"id": pid, "has_frontend": True}):
            with patch.object(plugins, "consented", lambda _doc: False):
                url = pack_url("koi-pond", "module.js")
                status, log = await self._get(url)
        assert status == 403
        assert "-> 403 error=forbidden origin" in log
        token = url.split("/pack-assets/", 1)[1].split("/", 1)[0]
        assert token not in log

    async def test_success_is_not_logged(self) -> None:
        row = {"id": "koi-pond", "has_frontend": True}
        with patch.object(plugins, "_plugin_row", lambda pid: row if pid == "koi-pond" else None):
            with patch.object(plugins, "consented", lambda _doc: True):
                with patch.object(plugins, "module_response", _module):
                    status, log = await self._get(pack_url("koi-pond", "module.js"))
        assert status == 200
        assert "pack-assets" not in log
