"""Persistent per-pack zip install blocks (start failure, etc.)."""
from __future__ import annotations

import json
import os
import tempfile
import threading
from pathlib import Path
from typing import Any

from . import paths
from .pack_id import pack_block_path, pack_id_valid, require_pack_id

_LOCK = threading.Lock()
_BY_SHA: dict[str, dict[str, str]] = {}
_BY_PACK: dict[str, dict[str, str]] = {}
_UNREADABLE_PACKS: set[str] = set()
_DIR_UNREADABLE = False
_CACHE_LOADED = False
_MIGRATED = False

REASON_COULDNT_START = "couldnt_start"
REASON_BLOCK_RECORD_UNREADABLE = "block_record_unreadable"
MESSAGE_BLOCK_RECORD_UNREADABLE = "block record unreadable"

LEGACY_STORE_NAME = ".zip-install-blocks.json"


def _plugin_local_dir(*, create: bool) -> Path:
    return paths.plugin_local_dir(create=create)


def _blocks_dir(*, create: bool = False) -> Path:
    return _plugin_local_dir(create=create) / "blocks"


def _legacy_store_path() -> Path:
    return _plugin_local_dir(create=False) / LEGACY_STORE_NAME


def _pack_block_path(pack_id: str, *, create: bool = False) -> Path:
    return pack_block_path(pack_id, create_blocks_dir=create)


def _row_unreadable(pack_id: str) -> dict[str, str]:
    return {
        "id": pack_id,
        "error": "pack_install_blocked",
        "blockReason": REASON_BLOCK_RECORD_UNREADABLE,
        "message": MESSAGE_BLOCK_RECORD_UNREADABLE,
        "retryable": "true",
    }


def _invalidate_cache() -> None:
    global _CACHE_LOADED, _BY_SHA, _BY_PACK, _UNREADABLE_PACKS, _DIR_UNREADABLE
    _CACHE_LOADED = False
    _BY_SHA = {}
    _BY_PACK = {}
    _UNREADABLE_PACKS = set()
    _DIR_UNREADABLE = False


def _atomic_write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(prefix=f"{path.name}.", suffix=".tmp", dir=path.parent)
    tmp = Path(tmp_name)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(json.dumps(payload, indent=2) + "\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp, path)
        dir_fd = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(dir_fd)
        finally:
            os.close(dir_fd)
    except Exception:
        try:
            tmp.unlink(missing_ok=True)
        except OSError:
            pass
        raise


def _migrate_legacy_store() -> None:
    global _MIGRATED
    if _MIGRATED:
        return
    legacy = _legacy_store_path()
    if not legacy.is_file():
        _MIGRATED = True
        return
    try:
        raw = json.loads(legacy.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        legacy.unlink(missing_ok=True)
        _MIGRATED = True
        return
    by_sha = raw.get("bySha256") if isinstance(raw, dict) else None
    if isinstance(by_sha, dict):
        for digest, row in by_sha.items():
            if not isinstance(row, dict):
                continue
            pack_id = str(row.get("id") or "").strip()
            if not pack_id_valid(pack_id):
                continue
            merged = {k: str(v) for k, v in row.items()}
            merged.setdefault("sha256", str(digest).strip().lower())
            _atomic_write_json(_pack_block_path(pack_id, create=True), merged)
    try:
        legacy.unlink(missing_ok=True)
    except OSError:
        pass
    _MIGRATED = True


def _read_pack_block_file(pack_id: str) -> dict[str, str] | None:
    path = _pack_block_path(pack_id)
    if not path.is_file():
        return None
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        _UNREADABLE_PACKS.add(pack_id)
        row = _row_unreadable(pack_id)
        _BY_PACK[pack_id] = row
        return row
    if not isinstance(raw, dict):
        _UNREADABLE_PACKS.add(pack_id)
        row = _row_unreadable(pack_id)
        _BY_PACK[pack_id] = row
        return row
    row = {k: str(v) for k, v in raw.items()}
    row.setdefault("id", pack_id)
    digest = str(row.get("sha256") or "").strip().lower()
    if digest:
        _BY_SHA[digest] = row
    _BY_PACK[pack_id] = row
    return row


def _load_store() -> None:
    global _CACHE_LOADED, _DIR_UNREADABLE
    if _CACHE_LOADED:
        return
    _migrate_legacy_store()
    blocks_dir = _blocks_dir(create=False)
    if not blocks_dir.exists():
        _CACHE_LOADED = True
        return
    try:
        names = list(blocks_dir.iterdir())
    except OSError:
        _DIR_UNREADABLE = True
        _CACHE_LOADED = True
        return
    for entry in names:
        if not entry.is_file() or entry.suffix.lower() != ".json":
            continue
        pack_id = entry.stem
        if not pack_id_valid(pack_id):
            continue
        if pack_id in _BY_PACK or pack_id in _UNREADABLE_PACKS:
            continue
        _read_pack_block_file(pack_id)
    _CACHE_LOADED = True


def zip_blocks_store_dir_unreadable() -> bool:
    with _LOCK:
        _load_store()
        return _DIR_UNREADABLE


def unreadable_block_record_count() -> int:
    with _LOCK:
        _load_store()
        return len(_UNREADABLE_PACKS)


def unreadable_block_record_pack_ids() -> list[str]:
    with _LOCK:
        _load_store()
        return sorted(_UNREADABLE_PACKS)


def record_zip_block(sha256: str, row: dict[str, str]) -> None:
    digest = sha256.strip().lower()
    pack_id = str(row.get("id") or "").strip()
    if not digest:
        return
    try:
        require_pack_id(pack_id)
    except ValueError:
        return
    payload = {k: str(v) for k, v in row.items()}
    payload["sha256"] = digest
    with _LOCK:
        _load_store()
        path = _pack_block_path(pack_id, create=True)
        _atomic_write_json(path, payload)
        _UNREADABLE_PACKS.discard(pack_id)
        _BY_PACK[pack_id] = payload
        _BY_SHA[digest] = payload


def clear_zip_block(sha256: str) -> bool:
    digest = sha256.strip().lower()
    with _LOCK:
        _load_store()
        row = _BY_SHA.get(digest)
        if row is None:
            for pack_id, hit in _BY_PACK.items():
                if str(hit.get("sha256") or "").lower() == digest:
                    row = hit
                    break
        if row is None:
            return False
        pack_id = str(row.get("id") or "").strip()
        if not pack_id:
            return False
        path = _pack_block_path(pack_id)
        if path.is_file():
            path.unlink(missing_ok=True)
        _BY_SHA.pop(digest, None)
        _BY_PACK.pop(pack_id, None)
        _UNREADABLE_PACKS.discard(pack_id)
        return True


def zip_block_for_pack(pack_id: str) -> dict[str, str] | None:
    pid = str(pack_id or "").strip()
    if not pid:
        return None
    with _LOCK:
        _load_store()
        if pid in _BY_PACK:
            return dict(_BY_PACK[pid])
        if pid in _UNREADABLE_PACKS:
            return dict(_row_unreadable(pid))
        hit = _read_pack_block_file(pid)
        return dict(hit) if hit else None


def zip_block_for_sha(sha256: str) -> dict[str, str] | None:
    digest = sha256.strip().lower()
    if not digest:
        return None
    with _LOCK:
        _load_store()
        hit = _BY_SHA.get(digest)
        if hit is not None:
            return dict(hit)
        for row in _BY_PACK.values():
            if str(row.get("sha256") or "").lower() == digest:
                return dict(row)
        return None


def catalog_row_for_block(row: dict[str, str], *, rel: str) -> dict[str, str]:
    out = dict(row)
    out.setdefault("file", rel)
    out.setdefault("zip", rel)
    out.setdefault("zipSha256", row.get("sha256", ""))
    out.setdefault("retryable", "true")
    return out


def catalog_row_for_store_unreadable(*, rel: str, pack_id: str) -> dict[str, str]:
    row = _row_unreadable(pack_id)
    return catalog_row_for_block(row, rel=rel)


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
