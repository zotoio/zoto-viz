"""Outermost HTTP guard: Host allowlist, path dot-segments, frame-embed headers."""
from __future__ import annotations

import ipaddress
import logging
import re
import socket
from typing import Iterable

from aiohttp import web

from .access import attach_frame_embed_policy

_log = logging.getLogger("zoto-viz.monitor")

HOST_REJECT_BODY = (
    "This zoto-viz server doesn't accept the address it was opened with. "
    "Open it by its IP address, or add this name to `allowed_hosts` in the server config."
)

_HOST_FORBIDDEN_CHARS = re.compile(r'[;,\s"\']')
_ENCODED_TRAVERSAL = re.compile(r"%2[eEfF]", re.IGNORECASE)


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
        if not re.fullmatch(r"[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?", host_part):
            raise ValueError(f"invalid allowed_hosts entry: {entry!r}") from None
    return f"{host_part}:{port_part}" if port_part else host_part


def parse_host_header(raw: str) -> tuple[str, str] | None:
    """Return (hostname_lower_or_literal, port_str) or None if malformed."""
    raw = (raw or "").strip()
    if not raw or _HOST_FORBIDDEN_CHARS.search(raw):
        return None
    host = raw
    port = ""
    if raw.startswith("["):
        end = raw.find("]")
        if end <= 0:
            return None
        host = raw[1:end]
        rest = raw[end + 1 :]
        if rest:
            if not rest.startswith(":"):
                return None
            port = rest[1:]
    elif raw.count(":") == 1:
        host, port = raw.rsplit(":", 1)
        if not port.isdigit():
            return None
    try:
        if host.lower() != "localhost":
            ipaddress.ip_address(host)
    except ValueError:
        if not re.fullmatch(r"[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?", host):
            return None
    return host.lower() if host.lower() == "localhost" else host, port


def _host_with_port(host: str, port: int) -> str:
    try:
        ip = ipaddress.ip_address(host)
        if isinstance(ip, ipaddress.IPv6Address):
            return f"[{host}]:{port}"
    except ValueError:
        pass
    return f"{host}:{port}"


def local_interface_hosts(port: int) -> set[str]:
    out: set[str] = set()
    out.add(_host_with_port("localhost", port))
    out.add(_host_with_port("127.0.0.1", port))
    out.add(_host_with_port("::1", port))
    seen: set[str] = set()
    try:
        for info in socket.getaddrinfo(None, 0, socket.AF_UNSPEC, socket.SOCK_DGRAM):
            addr = info[4][0]
            if addr in seen:
                continue
            seen.add(addr)
            if addr == "0.0.0.0":
                continue
            out.add(_host_with_port(addr, port))
    except OSError:
        pass
    return out


def canonical_host_port(host: str, port: str, default_port: int) -> str:
    p = port or str(default_port)
    if host.lower() == "localhost":
        return f"localhost:{p}"
    try:
        ip = ipaddress.ip_address(host)
        if isinstance(ip, ipaddress.IPv6Address):
            return f"[{ip.compressed}]:{p}"
        return f"{host}:{p}"
    except ValueError:
        return f"{host.lower()}:{p}"


def build_allowed_hosts(
    bind: str,
    port: int,
    extra: Iterable[str] | None = None,
) -> frozenset[str]:
    allowed: set[str] = set(local_interface_hosts(port))
    bind = (bind or "127.0.0.1").strip()
    if bind and bind not in {"0.0.0.0", "::"}:
        allowed.add(_host_with_port(bind, port))
    for item in extra or ():
        norm = validate_allowed_host_entry(str(item))
        if ":" in norm or norm.startswith("["):
            allowed.add(norm)
        elif norm == "localhost":
            allowed.add(_host_with_port("localhost", port))
        else:
            allowed.add(_host_with_port(norm, port))
    return frozenset(allowed)


def host_allowed(raw_host: str, allowed: frozenset[str], default_port: int) -> bool:
    parsed = parse_host_header(raw_host)
    if not parsed:
        return False
    host, port = parsed
    key = canonical_host_port(host, port, default_port)
    return key in allowed or key.lower() in {a.lower() for a in allowed}


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


def configure_request_guard(
    app: web.Application,
    *,
    bind: str,
    port: int,
    allowed_hosts: Iterable[str] | None = None,
) -> None:
    allowed = build_allowed_hosts(bind, port, allowed_hosts)
    app["request_guard_bind"] = bind
    app["request_guard_port"] = int(port)
    app["request_guard_allowed_hosts"] = allowed


def validated_http_origin(request: web.Request) -> str:
    cached = request.get("validated_http_origin")
    if cached:
        return str(cached)
    scheme = request.scheme or "http"
    raw = (request.headers.get("Host") or "").strip()
    return f"{scheme}://{raw}".rstrip("/")


@web.middleware
async def middleware(request: web.Request, handler):  # noqa: ANN001
    allowed: frozenset[str] = request.app.get("request_guard_allowed_hosts") or frozenset()
    port = int(request.app.get("request_guard_port") or 7020)
    raw_host = (request.headers.get("Host") or "").strip()

    if not raw_host or _HOST_FORBIDDEN_CHARS.search(raw_host) or parse_host_header(raw_host) is None:
        _log.warning("rejected Host header (format): %s", escape_log_host(raw_host))
        return web.Response(status=400, text="bad request", content_type="text/plain")

    if not host_allowed(raw_host, allowed, port):
        _log.warning("rejected Host header: %s", escape_log_host(raw_host))
        resp = web.Response(status=400, text=HOST_REJECT_BODY, content_type="text/plain")
        attach_frame_embed_policy(resp)
        return resp

    parsed = parse_host_header(raw_host)
    if parsed:
        host, p = parsed
        p = p or str(port)
        scheme = request.scheme or "http"
        try:
            ip = ipaddress.ip_address(host)
            host_hdr = f"[{host}]:{p}" if isinstance(ip, ipaddress.IPv6Address) else f"{host}:{p}"
        except ValueError:
            host_hdr = f"{host}:{p}"
        request["validated_http_origin"] = f"{scheme}://{host_hdr}".rstrip("/")

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
    attach_frame_embed_policy(resp)
    return resp
