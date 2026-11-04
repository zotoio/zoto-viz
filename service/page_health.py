"""Page heartbeat, client error reports, and a watchdog for long-running walls.

The browser posts ``/api/page/heartbeat`` every few seconds with fps, JS heap, live
AudioContexts and uptime. Thresholds (env-configurable, see ``Thresholds.from_env``) decide
whether the page is healthy; the reply tells the page to reload itself when the configured
action is ``reload``. A background loop flags pages whose heartbeat went stale (a hung or
crashed tab cannot ask for its own reload) in the monitor log (``/api/logs``).

``/api/page/error`` records uncaught page errors and unhandled rejections into the same log.
"""
from __future__ import annotations

import asyncio
import os
import time
from dataclasses import dataclass, field
from typing import Any

from aiohttp import web

from . import logbuf

MAX_PAGES = 32
ERRORS_PER_MIN = 20
MAX_ERR_TEXT = 1200


def _f(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, "") or default)
    except ValueError:
        return default


@dataclass
class Thresholds:
    max_audio_ctx: float = 8
    max_heap_mb: float = 1536
    min_fps: float = 5
    low_fps_sec: float = 60
    stale_sec: float = 30
    action: str = "flag"  # "flag" (log only) or "reload" (tell the page to reload)

    @classmethod
    def from_env(cls) -> "Thresholds":
        act = os.environ.get("ZOTO_VIZ_WD_ACTION", "flag").strip().lower()
        return cls(
            max_audio_ctx=_f("ZOTO_VIZ_WD_MAX_AUDIO_CTX", 8),
            max_heap_mb=_f("ZOTO_VIZ_WD_MAX_HEAP_MB", 1536),
            min_fps=_f("ZOTO_VIZ_WD_MIN_FPS", 5),
            low_fps_sec=_f("ZOTO_VIZ_WD_LOW_FPS_SEC", 60),
            stale_sec=_f("ZOTO_VIZ_WD_STALE_SEC", 30),
            action=act if act in ("flag", "reload") else "flag",
        )

    def public(self) -> dict[str, Any]:
        return dict(self.__dict__)


@dataclass
class PageRow:
    last: float = 0.0
    beat: dict[str, Any] = field(default_factory=dict)
    low_fps_since: float = 0.0
    flagged: str = ""
    stale_logged: bool = False
    err_window: float = 0.0
    err_count: int = 0


def _num(v: Any) -> float | None:
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    return x if x == x else None


def evaluate(row: PageRow, beat: dict[str, Any], th: Thresholds, now: float) -> str:
    """Reason the page is unhealthy, or '' when healthy. Hidden pages are not fps-judged."""
    ac = _num(beat.get("audioContexts"))
    if ac is not None and ac > th.max_audio_ctx:
        return f"audio contexts {int(ac)} > {int(th.max_audio_ctx)}"
    heap = _num(beat.get("heapMb"))
    if heap is not None and heap > th.max_heap_mb:
        return f"heap {heap:.0f} MB > {th.max_heap_mb:.0f} MB"
    fps = _num(beat.get("fps"))
    if beat.get("visible") and fps is not None and fps < th.min_fps:
        if not row.low_fps_since:
            row.low_fps_since = now
        if now - row.low_fps_since >= th.low_fps_sec:
            return f"fps {fps:.1f} < {th.min_fps:g} for {now - row.low_fps_since:.0f}s"
    else:
        row.low_fps_since = 0.0
    return ""


def _pages(app: web.Application) -> dict[str, PageRow]:
    return app.setdefault("page_health", {})  # type: ignore[no-any-return]


def _thresholds(app: web.Application) -> Thresholds:
    th = app.get("page_health_th")
    if th is None:
        th = Thresholds.from_env()
        app["page_health_th"] = th
    return th


def _page_id(body: dict[str, Any]) -> str:
    return str(body.get("page") or "anon")[:64]


async def api_heartbeat(request: web.Request) -> web.Response:
    try:
        body = await request.json()
    except Exception:  # noqa: BLE001
        return web.json_response({"ok": False, "error": "invalid json"}, status=400)
    if not isinstance(body, dict):
        return web.json_response({"ok": False, "error": "object required"}, status=400)
    app = request.app
    pages = _pages(app)
    pid = _page_id(body)
    if pid not in pages and len(pages) >= MAX_PAGES:
        oldest = min(pages, key=lambda k: pages[k].last)
        pages.pop(oldest, None)
    row = pages.setdefault(pid, PageRow())
    now = time.time()
    if row.stale_logged:
        logbuf.record(f"[watchdog] page {pid} heartbeat resumed")
    row.last, row.beat, row.stale_logged = now, body, False
    th = _thresholds(app)
    reason = evaluate(row, body, th, now)
    if reason and reason != row.flagged:
        logbuf.record(f"[watchdog] page {pid} unhealthy: {reason} (action={th.action})")
    row.flagged = reason
    action = "reload" if reason and th.action == "reload" else "none"
    return web.json_response({"ok": True, "action": action, "reason": reason, "thresholds": th.public()})


async def api_error(request: web.Request) -> web.Response:
    try:
        body = await request.json()
    except Exception:  # noqa: BLE001
        return web.json_response({"ok": False, "error": "invalid json"}, status=400)
    if not isinstance(body, dict):
        return web.json_response({"ok": False, "error": "object required"}, status=400)
    pages = _pages(request.app)
    pid = _page_id(body)
    row = pages.setdefault(pid, PageRow())
    now = time.time()
    if now - row.err_window > 60:
        row.err_window, row.err_count = now, 0
    row.err_count += 1
    if row.err_count > ERRORS_PER_MIN:
        return web.json_response({"ok": True, "dropped": True})
    kind = str(body.get("kind") or "error")[:32]
    msg = str(body.get("message") or "")[:MAX_ERR_TEXT]
    where = str(body.get("source") or "")[:200]
    count = int(_num(body.get("count")) or 1)
    rep = f" x{count}" if count > 1 else ""
    logbuf.record(f"[page {pid}] {kind}{rep}: {msg}" + (f" @ {where}" if where else ""))
    return web.json_response({"ok": True})


async def api_health(request: web.Request) -> web.Response:
    now = time.time()
    th = _thresholds(request.app)
    rows = {
        pid: {"ageSec": round(now - r.last, 1), "flagged": r.flagged, "stale": now - r.last > th.stale_sec, "beat": r.beat}
        for pid, r in _pages(request.app).items()
    }
    return web.json_response({"ok": True, "thresholds": th.public(), "pages": rows})


def sweep_stale(app: web.Application, now: float | None = None) -> list[str]:
    """Log pages whose heartbeat stopped (hung renderer, crashed tab, closed window)."""
    now = time.time() if now is None else now
    th = _thresholds(app)
    out = []
    for pid, r in _pages(app).items():
        if r.last and not r.stale_logged and now - r.last > th.stale_sec:
            r.stale_logged = True
            out.append(pid)
            logbuf.record(f"[watchdog] page {pid} heartbeat stale for {now - r.last:.0f}s: tab hung, crashed or closed")
    return out


async def watchdog_loop(app: web.Application) -> None:
    while True:
        await asyncio.sleep(10)
        try:
            sweep_stale(app)
        except Exception:  # noqa: BLE001
            pass
