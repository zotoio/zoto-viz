"""One wall notice per distinct blocked zip (drop-folder scan)."""
from __future__ import annotations

_seen_blocked: set[str] = set()


def reset_wall_notices_for_tests() -> None:
    _seen_blocked.clear()


def wall_notice_for_install_result(result: dict[str, object]) -> dict[str, str] | None:
    if result.get("ok"):
        return None
    message = str(result.get("message") or "")
    if not message:
        return None
    sha = str(result.get("sha256") or "").lower()
    zip_path = str(result.get("zip") or result.get("path") or "")
    key = f"{zip_path}::{sha}" if sha else zip_path
    if not key or key in _seen_blocked:
        return None
    _seen_blocked.add(key)
    return {
        "error": str(result.get("error") or "pack_install_blocked"),
        "message": message,
        "zip": zip_path,
    }
