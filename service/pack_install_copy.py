"""User-facing install result copy (normal status tone). Keep in sync with web install surfaces."""
from __future__ import annotations

import re
from pathlib import Path

from .pack_block_copy import BLOCK_FIX_TAIL, BLOCK_INSTALL, block_message

REASON_PACK_INSTALL_BLOCKED = "pack_install_blocked"
REASON_PACK_INSTALL_FAULT = "pack_install_fault"
REASON_SCHEMA_INVALID = "pack_schema_invalid"
REASON_ALREADY_EXISTS = "pack_already_exists"
REASON_ZIP_UNSAFE = "pack_zip_unsafe"
REASON_BOUNDARY_BLOCKED = "pack_boundary"
#: #111: an update the service refused, with the version you had still installed (the new version
#: couldn't be checked, or it couldn't start and the old one was put back). Carried as ``reasonCode``
#: next to the row's ``error`` category (the reasonCode convention of plugin_manifest_block rows).
#: Service and web branch on this code, never on the message, so the wording can change freely.
REASON_UPDATE_REFUSED = "update_refused"
#: #200: a fresh install whose safety check couldn't run (not a setup cause), so it wasn't installed.
#: Carried as ``reasonCode`` next to ``error: pack_install_check_unavailable``; the message is the shared
#: copy table's ``install_unchecked``.
REASON_INSTALL_UNCHECKED = "install_unchecked"

# UX Pro — zip install rejection copy (literal pins in tests; revert rows blank these).
ZIP_UX_CORRUPT_TAIL = "The file isn't a valid pack or is damaged."
ZIP_UX_CORRUPT_PRIOR_SUFFIX = ", so version {version} is still installed."
ZIP_UX_ENCRYPTED_TAIL = "It's password-protected. Zip it again without a password."
ZIP_UX_OVERSIZE_TAIL = "It unpacks to more than packs are allowed."

ZIP_UX_INSTALL_FAILED = "Couldn't install {stem}.zip. {tail}"
ZIP_UX_DROP_SCHEMA_TAIL = "The plugin id in this pack isn't valid."
ZIP_UX_DROP_ALREADY_EXISTS_TAIL = "This pack is already in the drop zone."
# #185: every block message has one shape (service/pack_block_copy.py).
BLOCKED_MESSAGE = BLOCK_INSTALL + " " + BLOCK_FIX_TAIL
FAULT_MESSAGE = (
    "Packs can't be installed right now because the list of installed packs couldn't be read. {detail}"
)

# UX Pro — upgrade swap rollback (literal pin; revert row blanks this template).
UPGRADE_ROLLBACK_UX_MESSAGE = (
    "Couldn't update {name} to version {new_version}, so version {old_version} is still installed. "
    "Try again, and if it keeps failing, check the server log."
)

_DEFAULT_ZIP_STEM = "pack"
_DISPLAY_STEM_MAX = 80
_LOG_ZIP_REJECTED = "pack zip install rejected: %s"

def blocked_message(plugin_name: str, detail: str) -> str:
    """``detail`` is the plain sentence ("it loads code from outside its own folder.")."""
    return block_message(plugin_name, detail)

def fault_message(detail: str) -> str:
    return FAULT_MESSAGE.format(detail=detail.strip())

def _sanitize_display_label(raw: str, *, default: str) -> str:
    base = "".join(ch for ch in raw if ch.isprintable() and ch not in "\t\n\r\f\v")
    base = base.strip()
    if not base:
        base = default
    if len(base) > _DISPLAY_STEM_MAX:
        base = base[: _DISPLAY_STEM_MAX - 3] + "..."
    return base

def sanitize_manifest_display_text(raw: str | None, *, default: str = "Plugin") -> str:
    """Manifest name/version as plain text: basename only, no controls, max 80 chars."""
    text = str(raw or default).replace("\\", "/")
    base = text.rsplit("/", 1)[-1]
    return _sanitize_display_label(base, default=default)

def sanitize_zip_display_stem(raw: str | None) -> str:
    """User-supplied zip label as plain text: basename only, no controls, max 80 chars."""
    text = str(raw or _DEFAULT_ZIP_STEM).replace("\\", "/")
    base = text.rsplit("/", 1)[-1]
    if base.lower().endswith(".zip"):
        base = base[:-4]
    return _sanitize_display_label(base, default=_DEFAULT_ZIP_STEM)

def upgrade_rollback_user_message(
    pack_name: str | None,
    new_version: str | int | None,
    old_version: str | int | None,
) -> str:
    name = sanitize_manifest_display_text(pack_name, default="Plugin")
    new_v = sanitize_manifest_display_text(
        str(new_version) if new_version is not None else "",
        default="?",
    )
    old_v = sanitize_manifest_display_text(
        str(old_version) if old_version is not None else "",
        default="?",
    )
    return UPGRADE_ROLLBACK_UX_MESSAGE.format(name=name, new_version=new_v, old_version=old_v)

def zip_display_stem_from_path(path: str | Path | None) -> str:
    if path is None:
        return _DEFAULT_ZIP_STEM
    return sanitize_zip_display_stem(Path(path).name)

def _couldnt_install_line(stem: str, tail: str) -> str:
    return ZIP_UX_INSTALL_FAILED.format(stem=sanitize_zip_display_stem(stem), tail=tail)

def drop_zone_schema_install_message(stem: str) -> str:
    return _couldnt_install_line(stem, ZIP_UX_DROP_SCHEMA_TAIL)

def drop_zone_already_exists_install_message(stem: str) -> str:
    return _couldnt_install_line(stem, ZIP_UX_DROP_ALREADY_EXISTS_TAIL)

def classify_zip_technical_reason(technical: str) -> str:
    low = (technical or "").lower()
    if "encrypted" in low or "password" in low:
        return "encrypted"
    if re.search(
        r"uncompressed size exceeds|compression ratio exceeds|zip has more than|zip exceeds \d+ bytes",
        low,
    ):
        return "oversize"
    return "corrupt"

def zip_unsafe_user_message(
    display_stem: str,
    technical: str,
    *,
    prior_version: int | str | None = None,
) -> str:
    stem = sanitize_zip_display_stem(display_stem)
    kind = classify_zip_technical_reason(technical)
    if kind == "encrypted":
        return _couldnt_install_line(stem, ZIP_UX_ENCRYPTED_TAIL)
    if kind == "oversize":
        return _couldnt_install_line(stem, ZIP_UX_OVERSIZE_TAIL)
    if prior_version is not None:
        tail = ZIP_UX_CORRUPT_TAIL.rstrip(".") + ZIP_UX_CORRUPT_PRIOR_SUFFIX.format(
            version=prior_version,
        )
        return _couldnt_install_line(stem, tail)
    return _couldnt_install_line(stem, ZIP_UX_CORRUPT_TAIL)

def zip_rejection_log_message(technical: str) -> str:
    return _LOG_ZIP_REJECTED.replace("%s", (technical or "").strip(), 1)
