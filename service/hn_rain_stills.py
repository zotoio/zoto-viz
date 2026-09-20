"""Composer 2.5 stills for HN Rain titles. Cached under ~/.zoto-viz/agent/stills."""
from __future__ import annotations

import asyncio
import hashlib
import json
import re
from pathlib import Path
from aiohttp import web

from . import cursor_agent
from . import cursor_stats
from . import paths

STILL_MODEL = "composer-2.5"
STILL_CACHE_TAG = "16x9"
STILL_TIMEOUT_S = 90
SVG_RE = re.compile(r"<svg[\s\S]+?</svg>", re.I)
_inflight: set[str] = set()
_queued: set[str] = set()
_queue: asyncio.Queue[str] | None = None
_worker: asyncio.Task[None] | None = None


def stills_dir() -> Path:
    d = paths.agent_dir() / "stills"
    d.mkdir(parents=True, exist_ok=True)
    return d


def title_key(title: str) -> str:
    body = f"{STILL_CACHE_TAG}:{(title or '').strip().lower()}"
    return hashlib.sha256(body.encode("utf-8")).hexdigest()[:16]


def extract_svg(text: str) -> str | None:
    m = SVG_RE.search(text or "")
    if not m:
        return None
    svg = m.group(0).strip()
    if len(svg) < 32 or len(svg) > 200_000:
        return None
    return svg


def cached_path(key: str) -> Path:
    return stills_dir() / f"{key}.svg"


def read_cached(title: str) -> str | None:
    p = cached_path(title_key(title))
    if not p.is_file():
        return None
    try:
        raw = p.read_text(encoding="utf-8")
    except OSError:
        return None
    return extract_svg(raw)


def write_cached(title: str, svg: str) -> Path:
    clean = extract_svg(svg)
    if not clean:
        raise ValueError("svg required")
    p = cached_path(title_key(title))
    p.write_text(clean, encoding="utf-8")
    return p


def reset_queue() -> None:
    """Test helper — drop the in-process Composer queue."""
    global _queue, _worker
    _inflight.clear()
    _queued.clear()
    _queue = None
    if _worker and not _worker.done():
        _worker.cancel()
    _worker = None


async def generate_svg(title: str) -> str:
    key = cursor_agent.read_key()
    if not key:
        raise RuntimeError("cursor key required")
    cli = cursor_agent.bridge_dir() / "cli.mjs"
    if not cli.is_file():
        raise RuntimeError("cursor-bridge missing")
    proc = await asyncio.create_subprocess_exec(
        cursor_agent.node_bin(), str(cli), "still",
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        env=cursor_agent._env(key),
        cwd=str(cursor_agent.bridge_dir()),
    )
    payload = json.dumps({"title": title, "model": STILL_MODEL}) + "\n"
    assert proc.stdin and proc.stdout
    out, err = await asyncio.wait_for(proc.communicate(payload.encode()), timeout=STILL_TIMEOUT_S)
    if proc.returncode not in (0, None):
        msg = (err.decode("utf-8", "replace") or out.decode("utf-8", "replace")).strip()
        raise RuntimeError(msg[:400] or "still failed")
    svg = None
    for line in out.decode("utf-8", "replace").splitlines():
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            continue
        if not isinstance(row, dict):
            continue
        cursor_stats.ingest(row)
        svg = extract_svg(str(row.get("svg") or row.get("text") or ""))
        if svg:
            break
        if row.get("error"):
            raise RuntimeError(str(row["error"])[:400])
    if not svg:
        raise RuntimeError("no svg from composer-2.5")
    return svg


def _ensure_worker() -> asyncio.Queue[str]:
    global _queue, _worker
    if _queue is None:
        _queue = asyncio.Queue()
    if _worker is None or _worker.done():
        _worker = asyncio.create_task(_pump())
    return _queue


async def _pump() -> None:
    q = _queue
    if q is None:
        return
    while True:
        title = await q.get()
        key = title_key(title)
        try:
            if not read_cached(title):
                _inflight.add(key)
                svg = await generate_svg(title)
                write_cached(title, svg)
        except Exception:
            pass
        finally:
            _inflight.discard(key)
            _queued.discard(key)
            q.task_done()


def enqueue(title: str) -> str:
    """Queue one title. Returns cached, pending, or need-key."""
    global _queue
    if read_cached(title):
        return "cached"
    if not cursor_agent.read_key():
        return "need-key"
    key = title_key(title)
    if key in _queued or key in _inflight:
        return "pending"
    if _queue is None:
        _queue = asyncio.Queue()
    _queued.add(key)
    _queue.put_nowait(title)
    try:
        _ensure_worker()
    except RuntimeError:
        pass
    return "pending"


async def api_still(request: web.Request) -> web.StreamResponse:
    title = str(request.query.get("title") or "").strip()[:240]
    if not title:
        return web.json_response({"error": "title required"}, status=400)
    hit = read_cached(title)
    if hit:
        return web.Response(text=hit, content_type="image/svg+xml")
    status = enqueue(title)
    if status == "need-key":
        return web.json_response(
            {"error": "set CURSOR_API_KEY", "status": "need-key"},
            status=503,
        )
    if status == "cached":
        hit = read_cached(title)
        if hit:
            return web.Response(text=hit, content_type="image/svg+xml")
    return web.json_response({"status": "pending", "model": STILL_MODEL}, status=202)
