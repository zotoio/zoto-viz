"""Retry blocked zip API: distinct HTTP status + retryResult per outcome."""
from __future__ import annotations

from aiohttp import web
from aiohttp.test_utils import AioHTTPTestCase, unittest_run_loop

from service import access
from service import plugin_local
from service.pack_install_retry import (
    RETRY_RESULT_IN_PROGRESS,
    RETRY_RESULT_NOT_BLOCKED,
    RETRY_RESULT_START_FAILED,
    RETRY_RESULT_SUCCESS,
    RETRY_RESULT_ZIP_CHANGED,
)


class RetryBlockedZipOutcomesTest(AioHTTPTestCase):
    async def get_application(self) -> web.Application:
        app = web.Application(middlewares=[access.middleware])
        app["csrf"] = "token-outcomes"
        app["insecure_lan"] = False
        app.router.add_post(
            "/api/ai/plugin/local/blocked/retry",
            plugin_local.api_retry_blocked_zip,
        )
        return app

    @unittest_run_loop
    async def test_not_blocked_404(self) -> None:
        resp = await self.client.post(
            "/api/ai/plugin/local/blocked/retry",
            headers={"Host": "127.0.0.1:7020", access.HEADER: "token-outcomes"},
            json={"sha256": "deadbeef"},
        )
        assert resp.status == 404
        body = await resp.json()
        assert body.get("retryResult") == RETRY_RESULT_NOT_BLOCKED

    @unittest_run_loop
    async def test_maps_retry_result_to_status_without_parsing_message(self) -> None:
        cases = [
            ({"ok": True, "retryResult": RETRY_RESULT_SUCCESS}, 200),
            ({"ok": False, "retryResult": RETRY_RESULT_START_FAILED, "error": "pack_install_start_failed"}, 400),
            ({"ok": False, "retryResult": RETRY_RESULT_ZIP_CHANGED, "error": "zip_hash_mismatch"}, 409),
            ({"ok": False, "retryResult": RETRY_RESULT_IN_PROGRESS, "error": "retry_in_progress"}, 409),
            ({"ok": False, "retryResult": RETRY_RESULT_NOT_BLOCKED, "error": "not_blocked"}, 404),
        ]
        for info, want in cases:
            assert plugin_local.retry_blocked_zip_http_status(info) == want
