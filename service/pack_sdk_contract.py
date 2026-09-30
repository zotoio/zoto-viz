"""Pack build SDK contract version (plugins/sdk/pack-sdk-contract.ts)."""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

_LEGACY_MANIFEST = "pack-build.manifest.json"
_CONTRACT_TS = Path(__file__).resolve().parents[1] / "plugins" / "sdk" / "pack-sdk-contract.ts"
_VERSION_RE = re.compile(r"export\s+const\s+PACK_SDK_CONTRACT_VERSION\s*=\s*(\d+)")


def host_sdk_contract_version() -> int:
    text = _CONTRACT_TS.read_text(encoding="utf-8")
    m = _VERSION_RE.search(text)
    if not m:
        raise ValueError("PACK_SDK_CONTRACT_VERSION missing in pack-sdk-contract.ts")
    return int(m.group(1))


def sdk_manifest_cache_path(runtime_parent: Path, pack_id: str) -> Path:
    return runtime_parent / ".pack-sdk" / f"{pack_id}.json"


def runtime_parent_for_sdk_cache(home: Path) -> Path:
    resolved = home.resolve()
    parts = resolved.parts
    if ".staging" in parts:
        idx = parts.index(".staging")
        return Path(*parts[:idx])
    return resolved.parent


def read_pack_sdk_manifest(home: Path) -> int | None:
    path = home / _LEGACY_MANIFEST
    if not path.is_file():
        return None
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(raw, dict):
        return None
    ver = raw.get("sdkContractVersion")
    if isinstance(ver, bool) or not isinstance(ver, (int, float)):
        return None
    return int(ver)


def read_cached_sdk_manifest(runtime_parent: Path, pack_id: str) -> int | None:
    path = sdk_manifest_cache_path(runtime_parent, pack_id)
    if not path.is_file():
        return None
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(raw, dict):
        return None
    ver = raw.get("sdkContractVersion")
    if isinstance(ver, bool) or not isinstance(ver, (int, float)):
        return None
    return int(ver)


def write_pack_sdk_manifest_cache(runtime_parent: Path, pack_id: str, version: int | None = None) -> None:
    ver = int(version if version is not None else host_sdk_contract_version())
    path = sdk_manifest_cache_path(runtime_parent, pack_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"sdkContractVersion": ver}, indent=2) + "\n", encoding="utf-8")


def format_sdk_older_message(name: str) -> str:
    from .pack_block_copy import SENTENCE_SDK_OLDER, block_message

    # pack lint can't fix this, so no "run pack lint" tail.
    return block_message(name, SENTENCE_SDK_OLDER, tail="")


def format_sdk_newer_message(name: str) -> str:
    label = name.strip() or "Plugin"
    return f"{label} needs a newer zoto-viz."


def catalog_sdk_contract_error(
    rel: str,
    doc: dict[str, Any],
    pack_version: int,
    host_version: int,
) -> dict[str, str]:
    name = str(doc.get("name") or doc.get("id") or "Plugin")
    pid = str(doc.get("id") or "")
    if pack_version < host_version:
        message = format_sdk_older_message(name)
    else:
        message = format_sdk_newer_message(name)
    return {
        "error": "pack_sdk_contract",
        "id": pid,
        "name": name,
        "file": rel,
        "zip": rel,
        "message": message,
        "packSdkContractVersion": str(pack_version),
        "hostSdkContractVersion": str(host_version),
    }


def assert_pack_sdk_compatible(
    home: Path,
    doc: dict[str, Any],
    rel: str,
    *,
    runtime_parent: Path | None = None,
) -> dict[str, str] | None:
    host = host_sdk_contract_version()
    pid = str(doc.get("id") or "")
    parent = runtime_parent if runtime_parent is not None else home.parent
    stamped = read_cached_sdk_manifest(parent, pid) if pid else None
    if stamped is None:
        stamped = read_pack_sdk_manifest(home)
    pack_ver = stamped if stamped is not None else 1
    if pack_ver == host:
        return None
    return catalog_sdk_contract_error(rel, doc, pack_ver, host)
