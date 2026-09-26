"""Outermost HTTP guard: Host allowlist, path dot-segments, frame-embed headers."""
from __future__ import annotations

import ipaddress
import json
import logging
import re
import socket
import subprocess
import time
from typing import Callable, Iterable

from aiohttp import web

from .access import attach_frame_embed_policy

_log = logging.getLogger("zoto-viz.monitor")

HOST_REJECT_BODY = (
    "This zoto-viz server doesn't accept the address it was opened with. "
    "Open it by its IP address, or add this name to `allowed_hosts` in the server config."
)

_HOST_FORBIDDEN_CHARS = re.compile(r'[;,\s"\']')
_HOSTNAME = re.compile(r"[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?")
_ENCODED_TRAVERSAL = re.compile(r"%2[eEfF]", re.IGNORECASE)

_monotonic: Callable[[], float] = time.monotonic
_interface_lookup_calls = 0


def set_request_guard_clock(clock: Callable[[], float]) -> None:
    global _monotonic
    _monotonic = clock


def reset_interface_lookup_counter() -> None:
    global _interface_lookup_calls
    _interface_lookup_calls = 0


def interface_lookup_count() -> int:
    return _interface_lookup_calls


def escape_log_host(raw: str) -> str:
    return (raw or "").replace("\\", "\\\\").replace("\n", "\\n").replace("\r", "\\r")


def validate_allowed_host_entry(entry: str) -> str:
    """Validate a single allowed_hosts config entry; return normalized host[:port]."""
    s = (entry or "").strip()
    if not s or _HOST_FORBIDDEN_CHARS.search(s):
        raise ValueError(f"invalid allowed_hosts entry: {entry!r}")
    host_part = s
    port_part: str | None = None
    if s.startswith("["):
        end = s.find("]")
        if end <= 0:
            raise ValueError(f"invalid allowed_hosts entry: {entry!r}")
        host_part = s[1:end]
        rest = s[end + 1 :]
        if rest:
            if not rest.startswith(":"):
                raise ValueError(f"invalid allowed_hosts entry: {entry!r}")
            port_part = rest[1:]
    elif s.count(":") == 1 and not s.startswith(":"):
        host_part, port_part = s.rsplit(":", 1)
    if port_part is not None:
        try:
            p = int(port_part)
        except ValueError:
            raise ValueError(f"invalid allowed_hosts entry: {entry!r}") from None
        if not 1 <= p <= 65535:
            raise ValueError(f"invalid allowed_hosts entry: {entry!r}")
    if not host_part:
        raise ValueError(f"invalid allowed_hosts entry: {entry!r}")
    if host_part.lower() == "localhost":
        return f"localhost:{port_part}" if port_part else "localhost"
    try:
        ipaddress.ip_address(host_part)
    except ValueError:
        if not _HOSTNAME.fullmatch(host_part):
            raise ValueError(f"invalid allowed_hosts entry: {entry!r}") from None
    return f"{host_part}:{port_part}" if port_part else host_part


def _canonical_key(host: str, port: int) -> str:
    if host.lower() == "localhost":
        return f"localhost:{port}"
    try:
        ip = ipaddress.ip_address(host)
        if isinstance(ip, ipaddress.IPv6Address):
            return f"[{ip.compressed}]:{port}"
        return f"{host}:{port}"
    except ValueError:
        return f"{host.lower()}:{port}"


def normalize_host_header_key(
    raw: str,
    bound_port: int,
    *,
    tls: bool = False,
) -> str | None:
    """Return normalised ``host:port`` allowlist key, or ``None`` if invalid."""
    raw = (raw or "").strip()
    if not raw or _HOST_FORBIDDEN_CHARS.search(raw):
        return None
    if "%" in raw:
        return None
    host = raw
    port_str = ""
    if raw.startswith("["):
        end = raw.find("]")
        if end <= 0:
            return None
        host = raw[1:end]
        rest = raw[end + 1 :]
        if not rest or not rest.startswith(":"):
            return None
        port_str = rest[1:]
    elif raw.count(":") == 1 and not raw.startswith(":"):
        host, port_str = raw.rsplit(":", 1)
        if not port_str.isdigit():
            return None
    if host.endswith("."):
        return None
    if not port_str:
        if not tls and bound_port == 80:
            port_str = "80"
        else:
            return None
    try:
        port = int(port_str)
    except ValueError:
        return None
    if not 1 <= port <= 65535:
        return None
    if host.lower() == "localhost":
        return _canonical_key("localhost", port)
    try:
        ipaddress.ip_address(host)
    except ValueError:
        if not _HOSTNAME.fullmatch(host):
            return None
    return _canonical_key(host, port)


def query_os_interface_addresses() -> list[str]:
    """IP address strings from local interfaces (stub only this in tests, not ``local_interface_hosts``)."""
    try:
        proc = subprocess.run(
            ["ip", "-j", "addr"],
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
        )
        if proc.returncode != 0:
            return []
        data = json.loads(proc.stdout or "[]")
        addrs: list[str] = []
        for iface in data:
            for info in iface.get("addr_info") or []:
                if info.get("family") not in ("inet", "inet6"):
                    continue
                local = info.get("local")
                if local:
                    addrs.append(str(local))
        return addrs
    except (OSError, ValueError, subprocess.TimeoutExpired, json.JSONDecodeError):
        return []


def local_interface_hosts(port: int) -> set[str]:
    global _interface_lookup_calls
    _interface_lookup_calls += 1
    out: set[str] = set()
    out.add(_canonical_key("localhost", port))
    out.add(_canonical_key("127.0.0.1", port))
    out.add(_canonical_key("::1", port))
    seen: set[str] = set()
    for addr in query_os_interface_addresses():
        if addr in seen or addr in {"0.0.0.0", "::"}:
            continue
        seen.add(addr)
        try:
            ip = ipaddress.ip_address(addr)
            if ip.is_loopback or ip.is_link_local:
                continue
        except ValueError:
            continue
        out.add(_canonical_key(addr, port))
    return out


def build_allowed_hosts(
    bind: str,
    port: int,
    extra: Iterable[str] | None = None,
) -> frozenset[str]:
    allowed: set[str] = set(local_interface_hosts(port))
    bind = (bind or "127.0.0.1").strip()
    if bind and bind not in {"0.0.0.0", "::"}:
        allowed.add(_canonical_key(bind, port))
    for item in extra or ():
        norm = validate_allowed_host_entry(str(item))
        if ":" in norm or norm.startswith("["):
            key = normalize_host_header_key(norm, port) or norm
            allowed.add(key)
        elif norm == "localhost":
            allowed.add(_canonical_key("localhost", port))
        else:
            allowed.add(_canonical_key(norm, port))
    return frozenset(allowed)


def decode_request_path(path: str) -> tuple[str | None, str | None]:
    """Return (normalized_path, error). error is 'traversal' or 'encoded'."""
    if not path:
        return "/", None
    raw = path.split("?", 1)[0]
    if not raw.startswith("/"):
        return None, "traversal"
    t = raw
    for _ in range(12):
        if _ENCODED_TRAVERSAL.search(t):
            return None, "encoded"
        prev = t
        from urllib.parse import unquote

        t = unquote(t)
        if t == prev:
            break
    if _ENCODED_TRAVERSAL.search(t):
        return None, "encoded"
    while "//" in t:
        t = t.replace("//", "/")
    if t.startswith("//") or "\\" in t:
        return None, "traversal"
    segments: list[str] = []
    for part in t.split("/"):
        if not part or part == ".":
            continue
        if part == "..":
            return None, "traversal"
        segments.append(part)
    return ("/" + "/".join(segments) if segments else "/"), None


def _refresh_allowed_hosts(app: web.Application) -> frozenset[str]:
    bind = str(app.get("request_guard_bind") or "127.0.0.1")
    port = int(app.get("request_guard_port") or 7020)
    extra = app.get("request_guard_extra_hosts") or []
    allowed = build_allowed_hosts(bind, port, extra)
    app["request_guard_allowed_hosts"] = allowed
    return allowed


def _host_reject_response() -> web.Response:
    resp = web.Response(status=400, text=HOST_REJECT_BODY, content_type="text/plain")
    attach_frame_embed_policy(resp)
    return resp


def register_response_prepare_hook(app: web.Application) -> None:
    if app.get("request_guard_prepare_hook"):
        return

    async def _on_prepare(_request: web.Request, response: web.StreamResponse) -> None:
        attach_frame_embed_policy(response)

    app.on_response_prepare.append(_on_prepare)
    app["request_guard_prepare_hook"] = True


def configure_request_guard(
    app: web.Application,
    *,
    bind: str,
    port: int,
    allowed_hosts: Iterable[str] | None = None,
    clock: Callable[[], float] | None = None,
) -> None:
    extra = list(allowed_hosts or [])
    app["request_guard_bind"] = bind
    app["request_guard_port"] = int(port)
    app["request_guard_extra_hosts"] = extra
    clk = clock or app.get("request_guard_clock", _monotonic)
    app["request_guard_clock"] = clk
    app["request_guard_last_if_lookup"] = 0.0
    _refresh_allowed_hosts(app)


def validated_http_origin(request: web.Request) -> str:
    cached = request.get("validated_http_origin")
    if cached:
        return str(cached)
    scheme = request.scheme or "http"
    raw = (request.headers.get("Host") or "").strip()
    return f"{scheme}://{raw}".rstrip("/")


def _host_header_values(request: web.Request) -> list[str]:
    try:
        return list(request.headers.getall("Host"))
    except Exception:
        single = request.headers.get("Host")
        return [single] if single else []


def _lookup_allowed(app: web.Application, key: str) -> bool:
    allowed: frozenset[str] = app.get("request_guard_allowed_hosts") or frozenset()
    if key in allowed:
        return True
    clock: Callable[[], float] = app.get("request_guard_clock", _monotonic)
    now = clock()
    last = float(app.get("request_guard_last_if_lookup") or 0.0)
    if now - last < 30.0:
        return False
    app["request_guard_last_if_lookup"] = now
    allowed = _refresh_allowed_hosts(app)
    return key in allowed


@web.middleware
async def middleware(request: web.Request, handler):  # noqa: ANN001
    port = int(request.app.get("request_guard_port") or 7020)
    hosts = _host_header_values(request)
    if not hosts or len(hosts) != 1:
        return _host_reject_response()

    raw_host = hosts[0].strip()
    tls = bool(request.secure)
    key = normalize_host_header_key(raw_host, port, tls=tls)
    if key is None:
        _log.warning("rejected Host header (format): %s", escape_log_host(raw_host))
        return _host_reject_response()

    if not _lookup_allowed(request.app, key):
        _log.warning("rejected Host header: %s", escape_log_host(raw_host))
        return _host_reject_response()

    scheme = request.scheme or "http"
    request["validated_http_origin"] = f"{scheme}://{key}".rstrip("/")

    raw_path = getattr(request, "raw_path", None) or request.path or "/"
    _norm_path, path_err = decode_request_path(raw_path)
    if path_err:
        resp = web.Response(status=400, text="bad request", content_type="text/plain")
        attach_frame_embed_policy(resp)
        return resp

    try:
        resp = await handler(request)
    except web.HTTPException as exc:
        resp = exc
    except Exception:
        _log.exception("unhandled error in request handler")
        resp = web.Response(status=500, text="internal server error", content_type="text/plain")
    attach_frame_embed_policy(resp)
    return resp
