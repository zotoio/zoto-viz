"""Agent-collected photos and SVG, stored under ~/.zoto-viz/agent/assets.

HTTPS only, public addresses only, size-capped. Used when the local model
emits ```photo / ```svg fences (AI Control required). The byte cap is a
disk / fetch bound, not a visual quality target — 24 MB fits NASA IOTD /
APOD originals (often 2–19 MB) that the old 1.5 MB cap rejected.
"""
from __future__ import annotations

import hashlib
import ipaddress
import json
import re
import socket
from pathlib import Path
from typing import Any
from urllib.parse import urljoin, urlparse

from aiohttp import ClientError, ClientSession, ClientTimeout, web

from . import agent
from . import paths

MAX_BYTES = 24_000_000
MAX_SVG = 80_000
MAX_REDIRECTS = 2
FETCH_S = 30
ID_RE = re.compile(r"^[a-f0-9]{12,32}$")
IMAGE_TYPES = {
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "image/svg+xml": ".svg",
}
BLOCKED_HOSTS = {
    "localhost",
    "localhost.localdomain",
    "metadata.google.internal",
    "metadata.google.com",
}


def assets_dir() -> Path:
    d = paths.agent_dir() / "assets"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _public_host(host: str) -> None:
    h = (host or "").strip().lower().rstrip(".")
    if not h or h in BLOCKED_HOSTS or h.endswith(".local") or h.endswith(".localhost"):
        raise ValueError("host not allowed")
    try:
        infos = socket.getaddrinfo(h, None, type=socket.SOCK_STREAM)
    except socket.gaierror as e:
        raise ValueError("could not resolve host") from e
    if not infos:
        raise ValueError("could not resolve host")
    for info in infos:
        raw = info[4][0]
        ip = ipaddress.ip_address(raw)
        if (
            ip.is_private
            or ip.is_loopback
            or ip.is_link_local
            or ip.is_multicast
            or ip.is_reserved
            or ip.is_unspecified
        ):
            raise ValueError("address not allowed")


def check_url(url: str) -> str:
    """Return a cleaned https URL or raise ValueError."""
    raw = (url or "").strip()
    if len(raw) > 2000:
        raise ValueError("url too long")
    parsed = urlparse(raw)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError("https url required")
    if parsed.port not in (None, 443):
        raise ValueError("port not allowed")
    _public_host(parsed.hostname)
    return parsed.geturl()


def _meta_path(aid: str) -> Path:
    return assets_dir() / f"{aid}.json"


def _read_meta(aid: str) -> dict[str, Any] | None:
    p = _meta_path(aid)
    if not p.is_file():
        return None
    try:
        raw = json.loads(p.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    return raw if isinstance(raw, dict) else None


def _write_meta(aid: str, row: dict[str, Any]) -> None:
    _meta_path(aid).write_text(json.dumps(row, ensure_ascii=False, indent=0), encoding="utf-8")


def _new_id(blob: bytes) -> str:
    return hashlib.sha256(blob).hexdigest()[:16]


def list_assets() -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for p in sorted(assets_dir().glob("*.json")):
        try:
            row = json.loads(p.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if isinstance(row, dict) and row.get("id"):
            out.append(row)
    return out


def clear_assets() -> int:
    n = 0
    for p in assets_dir().iterdir():
        if p.is_file():
            p.unlink()
            n += 1
    return n


def store_svg(markup: str) -> dict[str, Any]:
    text = (markup or "").strip()
    if not text.lower().startswith("<svg"):
        raise ValueError("svg markup required")
    if len(text) > MAX_SVG:
        raise ValueError("svg too large")
    blob = text.encode("utf-8")
    aid = _new_id(blob)
    dest = assets_dir() / f"{aid}.svg"
    dest.write_bytes(blob)
    row = {"id": aid, "kind": "svg", "mime": "image/svg+xml", "href": f"/api/ai/assets/{aid}", "bytes": len(blob)}
    _write_meta(aid, row)
    return row


def find_by_url(url: str) -> dict[str, Any] | None:
    """Return a cached photo row for this HTTPS URL, if we already fetched it."""
    try:
        want = check_url(url)[:300]
    except ValueError:
        return None
    for row in list_assets():
        if str(row.get("url") or "")[:300] == want or str(row.get("src") or "")[:300] == want:
            return row
    return None


def asset_path(aid: str, mime: str) -> Path | None:
    ext = IMAGE_TYPES.get(mime, ".bin")
    path = assets_dir() / f"{aid}{ext}"
    if path.is_file():
        return path
    hits = [p for p in assets_dir().glob(f"{aid}.*") if p.suffix != ".json"]
    return hits[0] if hits else None


async def ensure_photo(url: str) -> dict[str, Any]:
    hit = find_by_url(url)
    if hit:
        return hit
    return await fetch_photo(url)


async def fetch_photo(url: str) -> dict[str, Any]:
    requested = check_url(url)
    cached = find_by_url(requested)
    if cached:
        return cached
    current = requested
    timeout = ClientTimeout(total=FETCH_S)
    hops = 0
    async with ClientSession(timeout=timeout) as s:
        while True:
            async with s.get(
                current,
                allow_redirects=False,
                headers={"User-Agent": "zoto-viz/1.0", "Accept": "image/*,image/svg+xml"},
            ) as r:
                if r.status in {301, 302, 303, 307, 308}:
                    hops += 1
                    if hops > MAX_REDIRECTS:
                        raise ValueError("too many redirects")
                    loc = r.headers.get("Location") or ""
                    current = check_url(urljoin(current, loc))
                    continue
                if r.status >= 400:
                    raise ValueError(f"fetch failed ({r.status})")
                mime = (r.headers.get("Content-Type") or "").split(";")[0].strip().lower()
                if mime not in IMAGE_TYPES:
                    raise ValueError("not an image")
                cl = r.headers.get("Content-Length")
                if cl and cl.isdigit() and int(cl) > MAX_BYTES:
                    raise ValueError("image too large")
                blob = await r.read()
                if len(blob) > MAX_BYTES:
                    raise ValueError("image too large")
                if len(blob) < 32:
                    raise ValueError("image too small")
                aid = _new_id(blob)
                dest = assets_dir() / f"{aid}{IMAGE_TYPES[mime]}"
                dest.write_bytes(blob)
                row = {
                    "id": aid,
                    "kind": "photo",
                    "mime": mime,
                    "href": f"/api/ai/assets/{aid}",
                    "bytes": len(blob),
                    "url": current[:300],
                    "src": requested[:300],
                }
                _write_meta(aid, row)
                return row


def _control_gate() -> web.Response | None:
    if agent.ai_control_on():
        return None
    return web.json_response({"error": "AI Control is off", "aiControl": False}, status=403)


async def api_assets(req: web.Request) -> web.Response:
    """GET lists. POST {url} or {svg} stores (Control on). DELETE clears or one id."""
    if req.method == "GET":
        return web.json_response({"ok": True, "assets": list_assets()})
    denied = _control_gate()
    if denied:
        return denied
    if req.method == "DELETE":
        try:
            body = await req.json() if req.content_type and "json" in req.content_type else {}
        except Exception:
            body = {}
        if not isinstance(body, dict):
            body = {}
        query = getattr(getattr(req, "rel_url", None), "query", {}) or {}
        aid = str(body.get("id") or query.get("id") or "")
        if aid:
            if not ID_RE.fullmatch(aid):
                return web.json_response({"error": "bad id"}, status=400)
            n = 0
            for p in assets_dir().glob(f"{aid}.*"):
                p.unlink()
                n += 1
            return web.json_response({"ok": True, "removed": n})
        return web.json_response({"ok": True, "removed": clear_assets()})
    try:
        body = await req.json()
    except Exception:
        return web.json_response({"error": "invalid json"}, status=400)
    if not isinstance(body, dict):
        return web.json_response({"error": "object required"}, status=400)
    try:
        if body.get("svg"):
            row = store_svg(str(body.get("svg") or ""))
        elif body.get("url"):
            row = await fetch_photo(str(body.get("url") or ""))
        else:
            return web.json_response({"error": "url or svg required"}, status=400)
    except ValueError as e:
        return web.json_response({"error": str(e)}, status=400)
    except ClientError as e:
        return web.json_response({"error": f"fetch failed: {e}"}, status=400)
    return web.json_response({"ok": True, "asset": row})


def file_response(row: dict[str, Any]) -> web.Response:
    aid = str(row.get("id") or "")
    mime = str(row.get("mime") or "application/octet-stream")
    path = asset_path(aid, mime)
    if not path:
        return web.json_response({"error": "missing"}, status=404)
    return web.FileResponse(path, headers={"Content-Type": mime, "Cache-Control": "private, max-age=3600"})


async def api_asset(req: web.Request) -> web.Response:
    aid = str(req.match_info.get("id") or "")
    if not ID_RE.fullmatch(aid):
        return web.json_response({"error": "bad id"}, status=400)
    meta = _read_meta(aid)
    if not meta:
        return web.json_response({"error": "missing"}, status=404)
    return file_response(meta)
