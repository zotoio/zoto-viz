"""Catalog rows for packs the host cannot load (manifest / SDK), with plain-words copy."""
from __future__ import annotations

import re
from typing import Any

REASON_MANIFEST_UNKNOWN_KEYS = "manifest_unknown_keys"
REASON_MANIFEST_NEWER_SDK = "manifest_newer_sdk"

# Bump when the host understands new manifest keys / SDK contract (#45 workBudget, etc.).
HOST_ZOTO_SDK_VERSION = 1

_UNKNOWN_KEY_RE = re.compile(
    r"Additional properties are not allowed \((?P<keys>.+?) (?:was|were) unexpected\)"
)


def unknown_keys_from_schema_message(message: str) -> list[str]:
    m = _UNKNOWN_KEY_RE.search(message)
    if not m:
        return []
    raw = m.group("keys")
    if " were unexpected" in m.group(0):
        return [k.strip().strip("'\"") for k in raw.split(",") if k.strip()]
    return [raw.strip().strip("'\"")]


def unknown_keys_from_schema_errors(errors: list[Any]) -> list[str]:
    keys: list[str] = []
    for err in errors:
        if getattr(err, "validator", None) != "additionalProperties":
            continue
        keys.extend(unknown_keys_from_schema_message(str(err.message)))
    return sorted(set(keys))


def message_unknown_manifest_keys(plugin_id: str, keys: list[str]) -> str:
    joined = ", ".join(keys)
    return (
        f"{plugin_id} uses manifest keys this version of zoto-viz doesn't recognise "
        f"({joined})"
    )


def message_newer_sdk(plugin_id: str, pack_sdk: int, host_sdk: int = HOST_ZOTO_SDK_VERSION) -> str:
    return (
        f"{plugin_id} was built for a newer version of zoto-viz "
        f"(pack SDK {pack_sdk}, this monitor supports {host_sdk})"
    )


def blocked_catalog_row(
    *,
    plugin_id: str,
    name: str | None,
    file: str,
    reason_code: str,
    message: str,
    keys: list[str] | None = None,
    pack_sdk: int | None = None,
) -> dict[str, Any]:
    row: dict[str, Any] = {
        "id": plugin_id,
        "name": name or plugin_id,
        "file": file,
        "blocked": True,
        "reasonCode": reason_code,
        "message": message,
    }
    if keys:
        row["keys"] = list(keys)
    if pack_sdk is not None:
        row["packSdk"] = pack_sdk
        row["hostSdk"] = HOST_ZOTO_SDK_VERSION
    return row


def pack_sdk_newer_than_host(doc: dict[str, Any]) -> int | None:
    raw = doc.get("zoto_sdk_version")
    if isinstance(raw, bool):
        return None
    if isinstance(raw, int) and not isinstance(raw, bool):
        return raw if raw > HOST_ZOTO_SDK_VERSION else None
    if isinstance(raw, str) and raw.isdigit():
        n = int(raw)
        return n if n > HOST_ZOTO_SDK_VERSION else None
    return None
