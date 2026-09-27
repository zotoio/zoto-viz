"""Frame-bound HMAC tokens for ``/pack-assets/<token>/…``."""
from __future__ import annotations

import base64
import binascii
import hashlib
import hmac
import re

_TOKEN_ASCII = re.compile(r"^[\x21-\x7e]+$")
_FRAME_ID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
    re.I,
)


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")


def _b64url_decode(s: str) -> bytes | None:
    try:
        pad = "=" * (-len(s) % 4)
        return base64.urlsafe_b64decode(s + pad)
    except (ValueError, binascii.Error):
        return None


def _lp_encode(s: str) -> bytes:
    raw = s.encode("utf-8")
    return len(raw).to_bytes(4, "big") + raw


def encode_binding(session_id: str, pack_id: str, frame_id: str) -> bytes:
    """Length-prefixed UTF-8 fields (unambiguous vs concatenation)."""
    return _lp_encode(session_id) + _lp_encode(pack_id) + _lp_encode(frame_id)


def mint_pack_asset_token(secret: bytes, session_id: str, pack_id: str, frame_id: str) -> str:
    mac = hmac.new(secret, encode_binding(session_id, pack_id, frame_id), hashlib.sha256).digest()
    return f"{frame_id}.{_b64url(mac)}"


def frame_id_ok(frame_id: str) -> bool:
    return bool(frame_id and _FRAME_ID_RE.fullmatch(frame_id))


def parse_pack_asset_token(token: str) -> tuple[str, bytes] | None:
    if not token or not _TOKEN_ASCII.fullmatch(token):
        return None
    if "." not in token:
        return None
    frame_id, mac_b64 = token.rsplit(".", 1)
    if not _FRAME_ID_RE.fullmatch(frame_id):
        return None
    mac = _b64url_decode(mac_b64)
    if mac is None:
        return None
    return frame_id, mac


def verify_pack_asset_token(
    secret: bytes,
    pack_id: str,
    token: str,
    *,
    session_id: str | None = None,
    frame_live: bool = True,
) -> bool:
    if not secret or not pack_id or not token or not frame_live:
        return False
    try:
        pack_id.encode("ascii")
    except UnicodeEncodeError:
        return False
    parsed = parse_pack_asset_token(token)
    if parsed is None:
        return False
    frame_id, got_mac = parsed
    if session_id is None:
        return False
    try:
        session_id.encode("utf-8")
    except UnicodeEncodeError:
        return False
    expected = hmac.new(secret, encode_binding(session_id, pack_id, frame_id), hashlib.sha256).digest()
    if len(got_mac) != len(expected):
        return False
    return hmac.compare_digest(expected, got_mac)


def session_id_from_request(request) -> str:
    """Browser session key: CSRF header or cookie only (tokens are not app-wide bearer secrets)."""
    from . import access

    header = request.headers.get(access.HEADER, "").strip()
    if header:
        return header
    cookie = request.cookies.get(access.COOKIE, "").strip()
    if cookie:
        return cookie
    return ""
