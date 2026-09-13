"""Loopback Host/Origin checks, CSRF for mutating HTTP, and a mutate access log.

DNS rebinding is blocked by requiring a loopback Host (unless --insecure-lan). Browsers
that send Origin must also use a loopback origin. PUT/POST/DELETE need the CSRF cookie
plus X-Zoto-Viz-Csrf (same value), minted at process start.
"""
from __future__ import annotations

import hmac
import ipaddress
import secrets
from urllib.parse import urlparse

from aiohttp import web

COOKIE = "zoto-viz-csrf"
HEADER = "X-Zoto-Viz-Csrf"
MUTATE = frozenset({"POST", "PUT", "DELETE", "PATCH"})


def new_token() -> str:
    return secrets.token_urlsafe(32)


def bind_is_loopback(bind: str) -> bool:
    host = (bind or "").strip()
    if host in {"127.0.0.1", "localhost", "::1"}:
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def header_hostname(raw: str) -> str:
    raw = (raw or "").strip()
    if not raw:
        return ""
    if raw.startswith("["):
        end = raw.find("]")
        return raw[1:end].lower() if end > 0 else ""
    return raw.rsplit(":", 1)[0].lower() if raw.count(":") == 1 else raw.split(":")[0].lower()


def is_loopback_name(name: str) -> bool:
    if not name:
        return False
    if name in {"localhost", "127.0.0.1", "::1"}:
        return True
    try:
        return ipaddress.ip_address(name).is_loopback
    except ValueError:
        return False


def origin_hostname(origin: str) -> str:
    if not origin or origin == "null":
        return ""
    return (urlparse(origin).hostname or "").lower()


def host_ok(request: web.Request) -> bool:
    host = header_hostname(request.headers.get("Host", ""))
    if request.app.get("insecure_lan"):
        return bool(host)
    return is_loopback_name(host)


def origin_ok(request: web.Request) -> bool:
    raw = request.headers.get("Origin", "").strip()
    if not raw:
        return True  # curl / non-browser
    name = origin_hostname(raw)
    if request.app.get("insecure_lan"):
        return name == header_hostname(request.headers.get("Host", ""))
    return is_loopback_name(name)


def attach_csrf(request: web.Request, resp: web.StreamResponse) -> None:
    token = request.app.get("csrf") or ""
    if not token:
        return
    resp.set_cookie(COOKIE, token, httponly=True, samesite="Strict", path="/")
    resp.headers[HEADER] = token


def csrf_ok(request: web.Request) -> bool:
    token = request.app.get("csrf") or ""
    if not token:
        return False
    cookie = request.cookies.get(COOKIE, "")
    header = request.headers.get(HEADER, "")
    return bool(cookie and header
                and hmac.compare_digest(cookie, token)
                and hmac.compare_digest(header, token))


def _deny(msg: str, status: int = 403) -> web.Response:
    return web.json_response({"error": msg}, status=status)


@web.middleware
async def middleware(request: web.Request, handler):  # noqa: ANN001
    if not host_ok(request):
        return _deny("forbidden host")
    if not origin_ok(request):
        return _deny("forbidden origin")
    if request.method in MUTATE and request.path.rstrip("/") != "/mcp" and not csrf_ok(request):
        return _deny("csrf required")
    resp = await handler(request)
    attach_csrf(request, resp)
    if request.method in MUTATE:
        print(f"[monitor] {request.method} {request.path_qs} -> {getattr(resp, 'status', '?')}", flush=True)
    return resp
