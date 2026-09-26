"""User-facing install result copy (normal status tone). Keep in sync with web install surfaces."""
from __future__ import annotations

REASON_PACK_INSTALL_BLOCKED = "pack_install_blocked"
REASON_PACK_INSTALL_FAULT = "pack_install_fault"
REASON_SCHEMA_INVALID = "pack_schema_invalid"
REASON_ZIP_UNSAFE = "pack_zip_unsafe"
REASON_BOUNDARY_BLOCKED = "pack_boundary"


def blocked_message(plugin_name: str, detail: str) -> str:
    label = (plugin_name or "Plugin").strip()
    body = (detail or "Pack checks failed.").strip()
    return f"{label} was blocked. {body} Nothing was installed and the current wall is unchanged."


def fault_message(detail: str) -> str:
    return f"Pack install store is unreadable. {detail.strip()}"
