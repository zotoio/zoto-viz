"""Browser-reported pack frame instrumentation (GET/POST /api/pack-perf)."""

from __future__ import annotations

from typing import Any

from aiohttp import web


def _snapshot(app: web.Application) -> dict[str, Any]:
    raw = app.get("pack_perf")
    return raw if isinstance(raw, dict) else {"enabled": False}


async def api_pack_perf_get(request: web.Request) -> web.Response:
    return web.json_response({"ok": True, "perf": _snapshot(request.app)})


async def api_pack_perf_post(request: web.Request) -> web.Response:
    try:
        body = await request.json()
    except Exception:  # noqa: BLE001
        return web.json_response({"ok": False, "error": "invalid json"}, status=400)
    if not isinstance(body, dict):
        return web.json_response({"ok": False, "error": "object required"}, status=400)
    request.app["pack_perf"] = body
    return web.json_response({"ok": True})


def mcp_pack_perf_payload(app: web.Application | None) -> dict[str, Any]:
    if app is None:
        return {"ok": True, "perf": {"enabled": False}}
    return {"ok": True, "perf": _snapshot(app)}
