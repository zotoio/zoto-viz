"""In-process monitor log ring for GET /api/logs (frontend debug overlay)."""
from __future__ import annotations

import time
from collections import deque
from typing import Any

from aiohttp import web

MAX_LINES = 400
MAX_TEXT = 2000

_seq = 0
_lines: deque[dict[str, Any]] = deque(maxlen=MAX_LINES)


def reset_for_tests() -> None:
    global _seq
    _seq = 0
    _lines.clear()


def record(text: str) -> dict[str, Any]:
    global _seq
    from . import nasa_api

    _seq += 1
    row = {"seq": _seq, "t": time.time(), "text": nasa_api.redact_string(str(text))[:MAX_TEXT]}
    _lines.append(row)
    return row


def since(after: int = 0) -> dict[str, Any]:
    try:
        n = int(after)
    except (TypeError, ValueError):
        n = 0
    if n < 0:
        n = 0
    rows = [r for r in _lines if int(r["seq"]) > n]
    return {"seq": _seq, "lines": rows}


async def api_logs(request: web.Request) -> web.Response:
    after = request.query.get("after") or "0"
    return web.json_response({"ok": True, **since(after)})
