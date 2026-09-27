"""Startup-only install catalog records (interrupted restore, etc.)."""
from __future__ import annotations

import json
import threading
from pathlib import Path

from . import paths

_LOCK = threading.Lock()
_CACHE: list[dict[str, str]] | None = None


def _store_path() -> Path:
    return paths.plugin_local_dir(create=True) / ".install-catalog-records.json"


def _load() -> list[dict[str, str]]:
    global _CACHE
    if _CACHE is not None:
        return _CACHE
    path = _store_path()
    if not path.is_file():
        _CACHE = []
        return _CACHE
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        _CACHE = []
        return _CACHE
    rows = raw.get("records") if isinstance(raw, dict) else raw
    if not isinstance(rows, list):
        _CACHE = []
        return _CACHE
    _CACHE = [dict(r) for r in rows if isinstance(r, dict)]
    return _CACHE


def _save(rows: list[dict[str, str]]) -> None:
    global _CACHE
    path = _store_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"records": rows}, indent=2) + "\n", encoding="utf-8")
    _CACHE = rows


def append_catalog_record(row: dict[str, str], *, once_key: str) -> None:
    with _LOCK:
        rows = list(_load())
        if any(r.get("onceKey") == once_key for r in rows):
            return
        entry = {**row, "onceKey": once_key}
        rows.append(entry)
        _save(rows)


def drain_catalog_records() -> list[dict[str, str]]:
    """Return persisted records and clear them (shown once via catalog/errors)."""
    with _LOCK:
        rows = list(_load())
        _save([])
        return rows


def peek_catalog_records() -> list[dict[str, str]]:
    return list(_load())
