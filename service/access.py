"""Loopback Host/Origin checks, CSRF for mutating HTTP, and a mutate access log.

DNS rebinding is blocked by requiring a loopback Host (unless --insecure-lan). Browsers
that send Origin must also use a loopback origin. PUT/POST/DELETE need X-Zoto-Viz-Csrf matching the process token
(minted at start). The matching cookie is set for browsers but is not required.
"""
from __future__ import annotations

import hmac
import ipaddress
import re
import secrets
from urllib.parse import urlparse

from aiohttp import web

COOKIE = "zoto-viz-csrf"
HEADER = "X-Zoto-Viz-Csrf"
SANDBOX_ASSET_QUERY = "sat"
MUTATE = frozenset({"POST", "PUT", "DELETE", "PATCH"})

_PLUGIN_SANDBOX_ASSET = re.compile(
    r"^/api/plugins/([^/]+)/(module\.js|sky/fragment\.glsl)$",
)
_SANDBOX_BOOTSTRAP = re.compile(
    r"^/(?:plugin-sandbox\.html|assets/plugin-sandbox-[\w-]+\.js|assets/preload-helper-[\w-]+\.js)$",
)


def sandbox_static_bootstrap_path(path: str) -> bool:
    """Production sandbox iframe bootstrap (opaque origin) — not pack code."""
    return bool(_SANDBOX_BOOTSTRAP.match(path.rstrip("/") or "/"))


def sandbox_plugin_asset_path(path: str) -> bool:
    return bool(_PLUGIN_SANDBOX_ASSET.match(path.rstrip("/") or "/"))


def sandbox_plugin_asset_id(path: str) -> str | None:
    m = _PLUGIN_SANDBOX_ASSET.match(path.rstrip("/") or "/")
    return m.group(1) if m else None


def new_token() -> str:
    return secrets.token_urlsafe(32)


def new_sandbox_asset_token() -> str:
    """Per-process opaque-origin sandbox asset gate (>=128 bits). Never log."""
    return secrets.token_urlsafe(32)


def read_sandbox_asset_token(request: web.Request) -> str:
    return (request.query.get(SANDBOX_ASSET_QUERY) or "").strip()


def sandbox_asset_token_ok(request: web.Request) -> bool:
    expected = request.app.get("sandbox_asset_token") or ""
    got = read_sandbox_asset_token(request)
    if not expected or not got:
        return False
    return hmac.compare_digest(got, expected)


def append_sandbox_asset_query(path_or_url: str, token: str) -> str:
    """Append ``sat`` for sandbox iframe subresource URLs (in-memory token only)."""
    if not token:
        return path_or_url
    from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

    parsed = urlparse(path_or_url)
    q = dict(parse_qsl(parsed.query, keep_blank_values=True))
    q[SANDBOX_ASSET_QUERY] = token
    return urlunparse(parsed._replace(query=urlencode(q)))


def sandbox_null_origin_allowed(request: web.Request) -> bool:
    """Opaque-origin GET/HEAD only with a valid session asset token."""
    if request.method not in {"GET", "HEAD"}:
        return False
    if not sandbox_asset_token_ok(request):
        return False
    path = request.path or ""
    if sandbox_static_bootstrap_path(path):
        return True
    if not sandbox_plugin_asset_path(path):
        return False
    pid = sandbox_plugin_asset_id(path)
    if not pid:
        return False
    from . import plugins

    row = plugins._plugin_row(pid)
    if not row:
        return False
    return plugins.consented(row)


def attach_sandbox_cors(resp: web.StreamResponse) -> None:
    resp.headers["Access-Control-Allow-Origin"] = "null"
    vary = resp.headers.get("Vary", "")
    resp.headers["Vary"] = "Origin" if not vary else f"{vary}, Origin"


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
    if raw == "null":
        return sandbox_null_origin_allowed(request)
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
    """Header must match the process token. Cookie is optional: Vite's /api
    proxy and a monitor restart often leave a stale or missing cookie."""
    token = request.app.get("csrf") or ""
    header = request.headers.get(HEADER, "")
    if not token or not header:
        return False
    return hmac.compare_digest(header, token)


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
    origin_raw = request.headers.get("Origin", "").strip()
    if origin_raw == "null" and sandbox_null_origin_allowed(request):
        attach_sandbox_cors(resp)
    attach_csrf(request, resp)
    if request.method in MUTATE:
        print(f"[monitor] {request.method} {request.path_qs} -> {getattr(resp, 'status', '?')}", flush=True)
    return resp
