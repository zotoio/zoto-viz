"""Per-session, per-pack HMAC tokens for ``/pack-assets/<token>/…``."""
from __future__ import annotations

import base64
import binascii
import hashlib
import hmac
import re
import time

_TOKEN_ASCII = re.compile(r"^[\x21-\x7e]+$")


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")


def _b64url_decode(s: str) -> bytes | None:
    try:
        pad = "=" * (-len(s) % 4)
        return base64.urlsafe_b64decode(s + pad)
    except (ValueError, binascii.Error):
        return None


def mint_pack_asset_token(secret: bytes, session_id: str, pack_id: str, ttl_s: int = 86_400) -> str:
    """Mint a URL path token bound to ``session_id`` and ``pack_id`` (cookieless-safe)."""
    exp = int(time.time()) + max(60, ttl_s)
    sid = _b64url(session_id.encode("utf-8"))
    msg = f"{session_id}\0{pack_id}\0{exp}".encode("utf-8")
    mac = hmac.new(secret, msg, hashlib.sha256).digest()
    return f"{sid}.{exp}.{_b64url(mac[:24])}"


def verify_pack_asset_token(
    secret: bytes,
    pack_id: str,
    token: str,
    *,
    session_id: str | None = None,
    now: float | None = None,
) -> bool:
    if not secret or not pack_id or not token:
        return False
    if not _TOKEN_ASCII.fullmatch(token):
        return False
    try:
        pack_id.encode("ascii")
    except UnicodeEncodeError:
        return False
    parts = token.split(".", 2)
    if len(parts) != 3 or not parts[2]:
        return False
    sid_raw = _b64url_decode(parts[0])
    if sid_raw is None:
        return False
    try:
        token_session = sid_raw.decode("utf-8")
    except UnicodeDecodeError:
        return False
    if session_id is not None and token_session != session_id:
        return False
    try:
        exp = int(parts[1])
    except ValueError:
        return False
    t = now if now is not None else time.time()
    if exp < t:
        return False
    msg = f"{token_session}\0{pack_id}\0{exp}".encode("utf-8")
    expected = hmac.new(secret, msg, hashlib.sha256).digest()[:24]
    got = _b64url_decode(parts[2])
    if got is None or len(got) != 24:
        return False
    return hmac.compare_digest(expected, got)


def session_id_from_request(request) -> str:
    """Browser session key: CSRF header, then cookie, then app fallback (tests)."""
    from . import access

    header = request.headers.get(access.HEADER, "").strip()
    if header:
        return header
    cookie = request.cookies.get(access.COOKIE, "").strip()
    if cookie:
        return cookie
    return str(request.app.get("csrf") or "")
