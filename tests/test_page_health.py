import asyncio

from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer

from service import logbuf, page_health as ph


def th(**kw):
    return ph.Thresholds(**{**ph.Thresholds().__dict__, **kw})


def test_thresholds_from_env(monkeypatch):
    monkeypatch.setenv("ZOTO_VIZ_WD_MAX_AUDIO_CTX", "3")
    monkeypatch.setenv("ZOTO_VIZ_WD_ACTION", "reload")
    monkeypatch.setenv("ZOTO_VIZ_WD_MIN_FPS", "bad")
    t = ph.Thresholds.from_env()
    assert t.max_audio_ctx == 3 and t.action == "reload" and t.min_fps == 5
    monkeypatch.setenv("ZOTO_VIZ_WD_ACTION", "rm -rf")
    assert ph.Thresholds.from_env().action == "flag"


def test_evaluate_audio_heap_and_sustained_low_fps():
    row = ph.PageRow()
    t = th(max_audio_ctx=8, max_heap_mb=100, min_fps=5, low_fps_sec=60)
    assert ph.evaluate(row, {"audioContexts": 9}, t, 0).startswith("audio contexts 9")
    assert ph.evaluate(row, {"heapMb": 150}, t, 0).startswith("heap 150")
    assert ph.evaluate(row, {"fps": 2, "visible": True}, t, 100) == ""
    assert ph.evaluate(row, {"fps": 2, "visible": True}, t, 159) == ""
    assert "fps 2.0" in ph.evaluate(row, {"fps": 2, "visible": True}, t, 161)
    # hidden pages are throttled by the browser; never judged on fps
    assert ph.evaluate(row, {"fps": 0, "visible": False}, t, 500) == ""
    assert row.low_fps_since == 0.0


def _app(t):
    app = web.Application()
    app["page_health_th"] = t
    app.router.add_post("/api/page/heartbeat", ph.api_heartbeat)
    app.router.add_post("/api/page/error", ph.api_error)
    app.router.add_get("/api/page/health", ph.api_health)
    return app


def _run(coro_fn, t):
    async def go():
        client = TestClient(TestServer(_app(t)))
        await client.start_server()
        try:
            return await coro_fn(client)
        finally:
            await client.close()
    return asyncio.run(go())


def test_heartbeat_reload_action_and_log():
    logbuf.reset_for_tests()

    async def body(c):
        r = await c.post("/api/page/heartbeat", json={"page": "p1", "audioContexts": 20, "fps": 60, "visible": True})
        j = await r.json()
        assert j["action"] == "reload" and "audio contexts" in j["reason"]
        r = await c.post("/api/page/heartbeat", json={"page": "p1", "audioContexts": 1})
        assert (await r.json())["action"] == "none"
        h = await (await c.get("/api/page/health")).json()
        assert "p1" in h["pages"]
        assert (await c.post("/api/page/heartbeat", data="nope")).status == 400

    _run(body, th(action="reload"))
    assert any("[watchdog] page p1 unhealthy" in r["text"] for r in logbuf.since(0)["lines"])


def test_flag_action_never_reloads():
    async def body(c):
        r = await c.post("/api/page/heartbeat", json={"page": "p", "heapMb": 99999})
        assert (await r.json())["action"] == "none"
    _run(body, th(action="flag"))


def test_error_reports_logged_and_rate_limited():
    logbuf.reset_for_tests()

    async def body(c):
        for i in range(ph.ERRORS_PER_MIN + 5):
            await c.post("/api/page/error", json={"page": "e", "kind": "unhandledrejection", "message": f"boom {i}"})
    _run(body, th())
    lines = [r["text"] for r in logbuf.since(0)["lines"] if "[page e]" in r["text"]]
    assert len(lines) == ph.ERRORS_PER_MIN
    assert "unhandledrejection: boom 0" in lines[0]


def test_sweep_stale_logs_once():
    logbuf.reset_for_tests()
    app = web.Application()
    app["page_health_th"] = th(stale_sec=30)
    app["page_health"] = {"w": ph.PageRow(last=100.0)}
    assert ph.sweep_stale(app, now=120) == []
    assert ph.sweep_stale(app, now=200) == ["w"]
    assert ph.sweep_stale(app, now=300) == []


def test_growth_flags_heap_and_audio_leaks_within_window() -> None:
    from service.page_health import PageRow, Thresholds, evaluate

    th = Thresholds(max_heap_growth_mb=100, max_audio_ctx_growth=3, growth_window_sec=600)
    row = PageRow()
    assert evaluate(row, {"heapMb": 100, "audioContexts": 0}, th, 1000.0) == ""
    assert evaluate(row, {"heapMb": 150, "audioContexts": 1}, th, 1100.0) == ""
    assert "heap grew" in evaluate(row, {"heapMb": 260, "audioContexts": 1}, th, 1200.0)
    row2 = PageRow()
    evaluate(row2, {"heapMb": 100, "audioContexts": 0}, th, 0.0)
    assert "audio contexts grew 3" in evaluate(row2, {"heapMb": 100, "audioContexts": 3}, th, 60.0)


def test_growth_window_rebases_so_slow_steady_pages_stay_healthy() -> None:
    from service.page_health import PageRow, Thresholds, evaluate

    th = Thresholds(max_heap_growth_mb=100, growth_window_sec=600)
    row = PageRow()
    for i in range(10):
        # +60 MB per window: under the per-window limit every time
        assert evaluate(row, {"heapMb": 100 + i * 60}, th, i * 601.0) == ""
