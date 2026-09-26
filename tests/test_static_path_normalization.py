"""Static path guard: decode traversal before prefix checks."""
from __future__ import annotations

import tempfile
from pathlib import Path
from unittest.mock import MagicMock

from aiohttp.test_utils import AioHTTPTestCase

from service import monitor

HOST = {"Host": "127.0.0.1:7020"}
SANDBOX_SNIPPET = "zoto-viz-plugin-sandbox-leak"
_DIST = Path(tempfile.mkdtemp())
_DIST.joinpath("plugin-sandbox.html").write_text(
    f"<html><body>{SANDBOX_SNIPPET}</body></html>",
    encoding="utf-8",
)
_DIST.joinpath("index.html").write_text("<html><body>index</body></html>", encoding="utf-8")

BYPASS_PATHS = [
    "/ws/../plugin-sandbox.html",
    "/wsx/../",
    "/ws/..%2f",
    "/ws%2f..%2f",
    "/wsfoo%2f..%2f",
    "/api/../",
    "/api/%2e%2e/",
    "/mcp/../",
    "/pack-assets/../",
]


class StaticPathNormalizationTests(AioHTTPTestCase):
    @classmethod
    def setUpClass(cls) -> None:
        super().setUpClass()
        cls._orig_dist = monitor.WEB_DIST
        monitor.WEB_DIST = _DIST

    @classmethod
    def tearDownClass(cls) -> None:
        monitor.WEB_DIST = cls._orig_dist
        super().tearDownClass()

    async def get_application(self):
        state = MagicMock()
        app = monitor.make_app(state, "")
        app.on_startup.clear()
        app.on_shutdown.clear()
        app.on_cleanup.clear()
        return app

    async def test_traversal_cannot_reach_sandbox_html(self) -> None:
        must_404 = {
            "/ws/../plugin-sandbox.html",
            "/ws/..%2f",
            "/ws%2f..%2f",
            "/wsfoo%2f..%2f",
        }
        for path in BYPASS_PATHS:
            resp = await self.client.get(path, headers=HOST)
            body = await resp.text()
            assert SANDBOX_SNIPPET not in body, path
            if path in must_404 or path.endswith("plugin-sandbox.html"):
                assert resp.status == 404, path
