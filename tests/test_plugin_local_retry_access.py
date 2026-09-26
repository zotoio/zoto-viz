"""HTTP access for local plugin retry (CSRF + loopback origin)."""
from __future__ import annotations

from aiohttp import web
from aiohttp.test_utils import AioHTTPTestCase, unittest_run_loop

from service import access
from service import plugin_local


class RetryBlockedZipAccessTest(AioHTTPTestCase):
    async def get_application(self) -> web.Application:
        app = web.Application(middlewares=[access.middleware])
        app["csrf"] = "token-retry-test"
        app["insecure_lan"] = False
        app.router.add_post(
            "/api/ai/plugin/local/blocked/retry",
            plugin_local.api_retry_blocked_zip,
        )
        return app

    @unittest_run_loop
    async def test_retry_post_requires_csrf(self) -> None:
        resp = await self.client.post(
            "/api/ai/plugin/local/blocked/retry",
            headers={"Host": "127.0.0.1:7020"},
            json={"sha256": "deadbeef"},
        )
        assert resp.status == 403
        body = await resp.json()
        assert body.get("error") == "csrf required"

    @unittest_run_loop
    async def test_retry_post_ok_with_csrf_header(self) -> None:
        resp = await self.client.post(
            "/api/ai/plugin/local/blocked/retry",
            headers={
                "Host": "127.0.0.1:7020",
                access.HEADER: "token-retry-test",
            },
            json={"sha256": "deadbeef"},
        )
        assert resp.status == 404
        body = await resp.json()
        assert body.get("error") == "not_blocked"

    @unittest_run_loop
    async def test_retry_post_rejects_foreign_origin(self) -> None:
        resp = await self.client.post(
            "/api/ai/plugin/local/blocked/retry",
            headers={
                "Host": "127.0.0.1:7020",
                "Origin": "http://evil.example",
                access.HEADER: "token-retry-test",
            },
            json={"sha256": "deadbeef"},
        )
        assert resp.status == 403
        body = await resp.json()
        assert body.get("error") == "forbidden origin"
