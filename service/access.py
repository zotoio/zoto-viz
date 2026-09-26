"""Loopback Host/Origin checks, CSRF for mutating HTTP, and a mutate access log.

DNS rebinding is blocked by requiring a loopback Host (unless --insecure-lan). Browsers
that send Origin must also use a loopback origin. PUT/POST/DELETE need X-Zoto-Viz-Csrf matching the process token
(minted at start). The matching cookie is set for browsers but is not required.
"""
from __future__ import annotations

import hmac
import ipaddress
import logging
import re
from urllib.parse import quote, unquote, urlparse

import logging

from aiohttp import web
from aiohttp.abc import AbstractAccessLogger

from . import pack_asset_tokens

COOKIE = "zoto-viz-csrf"
HEADER = "X-Zoto-Viz-Csrf"
PACK_ASSETS_PREFIX = "/pack-assets/"
SANDBOX_TOKEN_REDACT = "<sandbox-token>"
MUTATE = frozenset({"POST", "PUT", "DELETE", "PATCH"})
_HOST_INJECTION = re.compile(r'[;\s,"\']')

_PACK_ASSETS = re.compile(
    r"^/pack-assets/([^/]+)/([^/]+)/(.+)$",
)


def parse_pack_assets_path(path: str) -> tuple[str, str, str] | None:
    p = path.split("?", 1)[0].rstrip("/") or "/"
    m = _PACK_ASSETS.match(p)
    if not m:
        return None
    return m.group(1), m.group(2), m.group(3)


def pack_asset_url(token: str, pack_id: str, *parts: str) -> str:
    segs = [quote(token, safe=""), quote(pack_id, safe="")]
    segs.extend(quote(part, safe="") for part in parts)
    return f"{PACK_ASSETS_PREFIX}{'/'.join(segs)}"


def new_token() -> str:
    import secrets

    return secrets.token_urlsafe(32)


def new_pack_asset_secret() -> bytes:
    import secrets

    return secrets.token_bytes(32)


def read_sandbox_asset_token(request: web.Request) -> str:
    parsed = parse_pack_assets_path(request.path or "")
    return parsed[0] if parsed else ""


def pack_asset_token_ok(request: web.Request) -> bool:
    from . import pack_asset_frames

    parsed = parse_pack_assets_path(request.path or "")
    if not parsed:
        return False
    token, pack_id, _tail = parsed
    secret = request.app.get("pack_asset_secret")
    if not secret:
        return False
    sid = pack_asset_tokens.session_id_from_request(request)
    if not sid:
        return False
    parsed_tok = pack_asset_tokens.parse_pack_asset_token(token)
    if not parsed_tok:
        return False
    frame_id, _mac = parsed_tok
    reg = pack_asset_frames.registry_for_app(request.app)
    live = reg.is_live(sid, frame_id)
    return pack_asset_tokens.verify_pack_asset_token(
        secret,
        pack_id,
        token,
        session_id=sid,
        frame_live=live,
    )


def redact_sandbox_token(text: str, token: str) -> str:
    if not text or not token:
        return text
    out = text.replace(token, SANDBOX_TOKEN_REDACT)
    out = out.replace(f"/pack-assets/{token}/", f"/pack-assets/{SANDBOX_TOKEN_REDACT}/")
    return out


def redact_request_path(path: str, token: str) -> str:
    parsed = parse_pack_assets_path(path or "")
    if not parsed or not token:
        return path
    got, pack_id, tail = parsed
    if got != token:
        return path
    return pack_asset_url(SANDBOX_TOKEN_REDACT, pack_id, *tail.split("/"))


def sandbox_null_origin_allowed(request: web.Request) -> bool:
    """Opaque-origin GET/HEAD only with a valid session asset token on /pack-assets/…"""
    if request.method not in {"GET", "HEAD"}:
        return False
    if not parse_pack_assets_path(request.path or ""):
        return False
    if not pack_asset_token_ok(request):
        return False
    _token, pack_id, _tail = parse_pack_assets_path(request.path or "")  # type: ignore[misc]
    if pack_id == "_sandbox":
        return True
    from . import plugins

    row = plugins._plugin_row(pack_id)
    if not row:
        return False
    return plugins.consented(row)


def attach_sandbox_cors(resp: web.StreamResponse) -> None:
    resp.headers["Access-Control-Allow-Origin"] = "null"
    vary = resp.headers.get("Vary", "")
    resp.headers["Vary"] = "Origin" if not vary else f"{vary}, Origin"


def attach_sandbox_referrer_policy(resp: web.StreamResponse) -> None:
    resp.headers["Referrer-Policy"] = "no-referrer"


def attach_pack_asset_json_headers(resp: web.StreamResponse) -> None:
    resp.headers["X-Content-Type-Options"] = "nosniff"
    resp.headers["Cache-Control"] = "no-store"


def attach_frame_embed_policy(resp: web.StreamResponse) -> None:
    """Every response must not be embeddable off-origin (including errors and static files)."""
    resp.headers["X-Frame-Options"] = "SAMEORIGIN"
    prior = resp.headers.get("Content-Security-Policy", "")
    frame = "frame-ancestors 'self'"
    if prior:
        if "frame-ancestors" not in prior:
            resp.headers["Content-Security-Policy"] = f"{prior}; {frame}"
    else:
        resp.headers["Content-Security-Policy"] = frame


def attach_html_frame_policy(resp: web.StreamResponse) -> None:
    attach_frame_embed_policy(resp)


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


def host_header_raw(request: web.Request) -> str:
    return (request.headers.get("Host") or "").strip()


def host_ok(request: web.Request) -> bool:
    raw = host_header_raw(request)
    if not raw or _HOST_INJECTION.search(raw):
        return False
    host = header_hostname(raw)
    if request.app.get("insecure_lan"):
        return bool(host)
    return is_loopback_name(host)


def pack_asset_csp_origin(request: web.Request) -> str:
    """Origin for sandbox CSP script-src (never raw untrusted Host fragments)."""
    configured = request.app.get("http_public_origin")
    if configured:
        return str(configured).rstrip("/")
    raw = host_header_raw(request)
    if not raw or _HOST_INJECTION.search(raw) or not host_ok(request):
        return "http://127.0.0.1"
    scheme = request.scheme or "http"
    return f"{scheme}://{raw}".rstrip("/")


def origin_ok(request: web.Request) -> bool:
    raw = request.headers.get("Origin", "").strip()
    if not raw:
        return True  # curl / non-browser
    if raw == "null":
        if parse_pack_assets_path(request.path or ""):
            return request.method in {"GET", "HEAD"}
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
    resp = web.json_response({"error": msg}, status=status)
    attach_pack_asset_json_headers(resp)
    attach_frame_embed_policy(resp)
    return resp


@web.middleware
async def frame_embed_policy_middleware(request: web.Request, handler):  # noqa: ANN001
    try:
        resp = await handler(request)
    except web.HTTPException as exc:
        resp = exc
    attach_frame_embed_policy(resp)
    return resp


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
    if parse_pack_assets_path(request.path or ""):
        attach_sandbox_referrer_policy(resp)
    attach_csrf(request, resp)
    if request.method in MUTATE:
        sat = read_sandbox_asset_token(request)
        safe = redact_request_path(request.path or "", sat) if sat else request.path
        print(f"[monitor] {request.method} {safe} -> {getattr(resp, 'status', '?')}", flush=True)
    return resp


class RedactingAccessLogger(AbstractAccessLogger):
    """aiohttp access logger that redacts pack-asset session tokens in the request line."""

    def log(self, request, response, time):  # noqa: ANN001
        if request is None:
            self.logger.info("-")
            return
        path_qs = request.path_qs
        token = read_sandbox_asset_token(request)
        if token:
            path_qs = redact_sandbox_token(path_qs, token)
        self.logger.info(
            '%s "%s %s" %s %.6f',
            request.remote or "-",
            request.method,
            path_qs,
            getattr(response, "status", "-"),
            time,
        )


def sandbox_access_log_factory(_app: web.Application) -> logging.Logger:
    return logging.getLogger("aiohttp.access")
