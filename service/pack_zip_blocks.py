"""Persistent zip content-hash install blocks (start failure, etc.)."""
from __future__ import annotations

import json
import threading
from pathlib import Path
from typing import Any

from . import paths

_LOCK = threading.Lock()
_CACHE: dict[str, dict[str, str]] | None = None

REASON_COULDNT_START = "couldnt_start"


def _store_path() -> Path:
    return paths.plugin_local_dir(create=True) / ".zip-install-blocks.json"


def _load() -> dict[str, dict[str, str]]:
    global _CACHE
    if _CACHE is not None:
        return _CACHE
    path = _store_path()
    if not path.is_file():
        _CACHE = {}
        return _CACHE
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        _CACHE = {}
        return _CACHE
    by_sha = raw.get("bySha256") if isinstance(raw, dict) else None
    _CACHE = {str(k): dict(v) for k, v in by_sha.items()} if isinstance(by_sha, dict) else {}
    return _CACHE


def _save(data: dict[str, dict[str, str]]) -> None:
    global _CACHE
    path = _store_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"bySha256": data}, indent=2) + "\n", encoding="utf-8")
    _CACHE = data


def reset_zip_blocks_for_tests() -> None:
    global _CACHE
    with _LOCK:
        _CACHE = {}
        path = _store_path()
        if path.is_file():
            path.unlink(missing_ok=True)


def record_zip_block(sha256: str, row: dict[str, str]) -> None:
    digest = sha256.strip().lower()
    if not digest:
        return
    with _LOCK:
        data = dict(_load())
        data[digest] = {k: str(v) for k, v in row.items()}
        _save(data)


def clear_zip_block(sha256: str) -> bool:
    digest = sha256.strip().lower()
    with _LOCK:
        data = dict(_load())
        if digest not in data:
            return False
        del data[digest]
        _save(data)
        return True


def zip_block_for_sha(sha256: str) -> dict[str, str] | None:
    digest = sha256.strip().lower()
    hit = _load().get(digest)
    return dict(hit) if hit else None


def catalog_row_for_block(row: dict[str, str], *, rel: str) -> dict[str, str]:
    out = dict(row)
    out.setdefault("file", rel)
    out.setdefault("zip", rel)
    out.setdefault("zipSha256", row.get("sha256", ""))
    out.setdefault("retryable", "true")
    return out


def row_for_start_failure(
    *,
    sha256: str,
    message: str,
    pack_id: str,
    name: str,
    zip_path: str,
    version: str | int | None,
) -> dict[str, str]:
    return {
        "error": "pack_install_start_failed",
        "blockReason": REASON_COULDNT_START,
        "message": message,
        "sha256": sha256,
        "id": pack_id,
        "name": name,
        "zip": zip_path,
        "version": str(version) if version is not None else "",
        "upgrade_blocked": "true",
        "retryable": "true",
    }
