"""frame-ancestors and X-Frame-Options on every response."""
from __future__ import annotations

import tempfile
from pathlib import Path
from unittest.mock import MagicMock

from aiohttp.test_utils import AioHTTPTestCase

from service import access, monitor

HOST = {"Host": "127.0.0.1:7020"}
_DIST = Path(tempfile.mkdtemp())
_DIST.joinpath("index.html").write_text("<html><body>ok</body></html>", encoding="utf-8")

CASES = [
    ("/", {200, 404}),
    ("/index.html", {200}),
    ("/api/session", {200}),
    ("/no-such-path", {404}),
    ("/pack-assets/bad-token/demo/module.js", {401}),
]


class FrameEmbedPolicyTests(AioHTTPTestCase):
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

    def _assert_frame_locked(self, resp) -> None:
        assert resp.headers.get("X-Frame-Options") == "SAMEORIGIN"
        csp = resp.headers.get("Content-Security-Policy") or ""
        assert "frame-ancestors 'self'" in csp

    async def test_frame_policy_on_responses(self) -> None:
        for path, status_ok in CASES:
            headers = {**HOST, access.HEADER: "test-session"} if path.startswith("/pack-assets/") else HOST
            resp = await self.client.get(path, headers=headers)
            assert resp.status in status_ok, path
            self._assert_frame_locked(resp)
