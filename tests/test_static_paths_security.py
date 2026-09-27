"""Static dist path guards (``service/static_paths``) — one assertion per security mutant."""
from __future__ import annotations

from service import static_paths


def test_canonical_static_path_rejects_leading_double_slash() -> None:
    assert static_paths.canonical_static_path("//etc/passwd") is None


def test_canonical_static_path_rejects_backslash_segments() -> None:
    assert static_paths.canonical_static_path("/assets\\..\\secret") is None


def test_decode_path_rejects_double_encoded_dot_segments() -> None:
    """Multi-pass decode must collapse %252e%252e before canonicalization."""
    raw = "/%252e%252e/plugin-sandbox.html"
    assert static_paths.static_path_allowed(raw) is False


def test_is_legacy_sandbox_request_matches_blocked_basename() -> None:
    assert static_paths.is_legacy_sandbox_request("/plugin-sandbox.html") is True
    assert static_paths.is_legacy_sandbox_request("/assets/plugin-sandbox.html") is True
    assert static_paths.is_legacy_sandbox_request("/index.html") is False
