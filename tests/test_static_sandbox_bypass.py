"""Legacy plugin-sandbox.html must not be reachable via static path tricks."""
from __future__ import annotations

import tempfile
from pathlib import Path
from unittest.mock import MagicMock

from aiohttp import web
from aiohttp.test_utils import AioHTTPTestCase

from service import monitor, request_guard
SANDBOX_SNIPPET = "zoto-viz-plugin"
_DIST = Path(tempfile.mkdtemp())
_DIST.joinpath("plugin-sandbox.html").write_text(
    f"<html><body>{SANDBOX_SNIPPET}</body></html>",
    encoding="utf-8",
)
_DIST.joinpath("index.html").write_text("<html><body>index</body></html>", encoding="utf-8")


class StaticSandboxBypassTests(AioHTTPTestCase):
    @classmethod
    def setUpClass(cls) -> None:
        super().setUpClass()
        cls._orig_dist = monitor.WEB_DIST
        monitor.WEB_DIST = _DIST

    @classmethod
    def tearDownClass(cls) -> None:
        monitor.WEB_DIST = cls._orig_dist
        super().tearDownClass()

    async def get_application(self) -> web.Application:
        state = MagicMock()
        app = monitor.make_app(state, "", port=7020)
        app.on_startup.clear()
        app.on_shutdown.clear()
        app.on_cleanup.clear()
        return app

    async def setUpAsync(self) -> None:
        await super().setUpAsync()
        self.client.server.skip_url_asserts = True
        request_guard.configure_request_guard(
            self.client.app, bind="127.0.0.1", port=self.client.port,
        )

    def _host(self) -> dict[str, str]:
        return {"Host": f"127.0.0.1:{self.client.port}"}

    async def _assert_no_sandbox(self, path: str) -> None:
        resp = await self.client.get(path, headers=self._host())
        assert resp.status == 404
        body = await resp.text()
        assert SANDBOX_SNIPPET not in body

    async def test_bare_plugin_sandbox_html(self) -> None:
        await self._assert_no_sandbox("/plugin-sandbox.html")

    async def test_dot_slash_plugin_sandbox_html(self) -> None:
        await self._assert_no_sandbox("/./plugin-sandbox.html")

    async def test_assets_parent_plugin_sandbox_html(self) -> None:
        await self._assert_no_sandbox("/assets/../plugin-sandbox.html")

    async def test_trailing_slash_plugin_sandbox_html(self) -> None:
        await self._assert_no_sandbox("/plugin-sandbox.html/")

    async def test_encoded_dot_plugin_sandbox_html(self) -> None:
        await self._assert_no_sandbox("/%2E/plugin-sandbox.html")

    async def test_encoded_pack_assets_traversal_index(self) -> None:
        resp = await self.client.get("/pack-assets%2FX%2F..%2F..%2Findex.html", headers=self._host())
        assert resp.status == 400
        body = await resp.text()
        assert SANDBOX_SNIPPET not in body
