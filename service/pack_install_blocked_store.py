"""Blocked zip install records (until sha changes or zip is removed)."""
from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

from . import paths
from .pack_install_copy import REASON_PACK_INSTALL_FAULT, fault_message

_LOG = logging.getLogger(__name__)
_STORE = ".pack-install-blocked.json"


def _path() -> Path:
    return paths.plugin_local_dir(create=True) / _STORE


def _read() -> dict[str, Any]:
    path = _path()
    if not path.is_file():
        return {}
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as e:
        _LOG.warning("pack install blocked store unreadable: %s", e)
        raise PackInstallStoreFault(fault_message(str(e))) from e
    return raw if isinstance(raw, dict) else {}


def _write(data: dict[str, Any]) -> None:
    path = _path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")


class PackInstallStoreFault(RuntimeError):
    """Corrupt blocked store — reported as a real fault."""


def reset_blocked_store_for_tests() -> None:
    path = _path()
    if path.is_file():
        path.unlink(missing_ok=True)


def record_blocked_zip(
    *,
    pack_id: str,
    sha256: str,
    message: str,
    zip_path: str,
    reason: str,
) -> None:
    data = _read()
    by_sha = data.setdefault("bySha", {})
    if not isinstance(by_sha, dict):
        by_sha = {}
        data["bySha"] = by_sha
    by_sha[sha256.lower()] = {
        "id": pack_id,
        "message": message,
        "zip": zip_path,
        "reason": reason,
    }
    by_pack = data.setdefault("byPack", {})
    if not isinstance(by_pack, dict):
        by_pack = {}
        data["byPack"] = by_pack
    by_pack[pack_id] = sha256.lower()
    _write(data)


def clear_blocked_pack(pack_id: str) -> None:
    data = _read()
    by_pack = data.get("byPack")
    if not isinstance(by_pack, dict):
        return
    sha = by_pack.pop(pack_id, None)
    if sha and isinstance(data.get("bySha"), dict):
        data["bySha"].pop(str(sha), None)
    _write(data)


def clear_blocked_zip(sha256: str) -> None:
    data = _read()
    by_sha = data.get("bySha")
    if not isinstance(by_sha, dict):
        return
    row = by_sha.pop(sha256.lower(), None)
    if isinstance(row, dict):
        pid = str(row.get("id") or "")
        by_pack = data.get("byPack")
        if isinstance(by_pack, dict) and by_pack.get(pid) == sha256.lower():
            by_pack.pop(pid, None)
    _write(data)


def blocked_row_for_sha(sha256: str) -> dict[str, str] | None:
    data = _read()
    by_sha = data.get("bySha")
    if not isinstance(by_sha, dict):
        return None
    row = by_sha.get(sha256.lower())
    return dict(row) if isinstance(row, dict) else None


def pack_info_blocked_line(pack_id: str) -> str | None:
    data = _read()
    by_pack = data.get("byPack")
    if not isinstance(by_pack, dict):
        return None
    sha = by_pack.get(pack_id)
    if not sha:
        return None
    by_sha = data.get("bySha")
    if not isinstance(by_sha, dict):
        return None
    row = by_sha.get(str(sha))
    if not isinstance(row, dict):
        return None
    return str(row.get("message") or "")
