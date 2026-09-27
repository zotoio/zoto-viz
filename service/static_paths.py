"""Canonical path checks for dist static files (block traversal aliases and legacy sandbox HTML)."""
from __future__ import annotations

from urllib.parse import unquote

_LEGACY_SANDBOX = "plugin-sandbox.html"
_BLOCKED_STATIC = frozenset({_LEGACY_SANDBOX})


def _decode_path(path: str) -> str:
    t = path
    for _ in range(6):
        prev = t
        t = unquote(t)
        if t == prev:
            break
    return t


def canonical_static_path(path: str) -> str | None:
    """Return a normalized absolute path (leading slash, no dot segments) or None if invalid."""
    if not path:
        return None
    raw = path.split("?", 1)[0]
    if not raw.startswith("/"):
        return None
    decoded = _decode_path(raw)
    if decoded.startswith("//") or "\\" in decoded:
        return None
    segments: list[str] = []
    for part in decoded.split("/"):
        if not part or part == ".":
            continue
        if part == "..":
            return None
        segments.append(part)
    if not segments:
        return "/"
    return "/" + "/".join(segments)


def static_path_allowed(request_path: str) -> bool:
    """Refuse paths that differ from their canonical form or hit blocked basenames."""
    canon = canonical_static_path(request_path)
    if canon is None:
        return False
    raw = request_path.split("?", 1)[0]
    decoded = _decode_path(raw)
    if decoded != canon and raw != canon:
        return False
    base = canon.rsplit("/", 1)[-1]
    if base in _BLOCKED_STATIC:
        return False
    return True


def is_legacy_sandbox_request(request_path: str) -> bool:
    canon = canonical_static_path(request_path)
    return canon is not None and canon.rsplit("/", 1)[-1] == _LEGACY_SANDBOX
