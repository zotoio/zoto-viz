"""User-facing install result copy (normal status tone). Keep in sync with web install surfaces."""
from __future__ import annotations

import re
from pathlib import Path

REASON_PACK_INSTALL_BLOCKED = "pack_install_blocked"
REASON_PACK_INSTALL_FAULT = "pack_install_fault"
REASON_SCHEMA_INVALID = "pack_schema_invalid"
REASON_ZIP_UNSAFE = "pack_zip_unsafe"
REASON_BOUNDARY_BLOCKED = "pack_boundary"

# UX Pro — zip install rejection copy (literal pins in tests; revert rows blank these).
ZIP_UX_CORRUPT_TAIL = "The file isn't a valid pack or is damaged."
ZIP_UX_CORRUPT_PRIOR_SUFFIX = ", so version {version} is still installed."
ZIP_UX_ENCRYPTED_TAIL = "It's password-protected. Zip it again without a password."
ZIP_UX_OVERSIZE_TAIL = "It unpacks to more than packs are allowed."

_DEFAULT_ZIP_STEM = "pack"
_DISPLAY_STEM_MAX = 80
_LOG_ZIP_REJECTED = "pack zip install rejected: %s"


def blocked_message(plugin_name: str, detail: str) -> str:
    label = (plugin_name or "Plugin").strip()
    body = (detail or "Pack checks failed.").strip()
    return f"{label} was blocked. {body} Nothing was installed and the current wall is unchanged."


def fault_message(detail: str) -> str:
    return f"Pack install store is unreadable. {detail.strip()}"


def sanitize_zip_display_stem(raw: str | None) -> str:
    """User-supplied zip label as plain text: basename only, no controls, max 80 chars."""
    text = str(raw or _DEFAULT_ZIP_STEM).replace("\\", "/")
    base = text.rsplit("/", 1)[-1]
    if base.lower().endswith(".zip"):
        base = base[:-4]
    base = "".join(ch for ch in base if ch.isprintable() and ch not in "\t\n\r\f\v")
    base = base.strip()
    if not base:
        base = _DEFAULT_ZIP_STEM
    if len(base) > _DISPLAY_STEM_MAX:
        base = base[: _DISPLAY_STEM_MAX - 3] + "..."
    return base


def zip_display_stem_from_path(path: str | Path | None) -> str:
    if path is None:
        return _DEFAULT_ZIP_STEM
    return sanitize_zip_display_stem(Path(path).name)


def _couldnt_install_line(stem: str, tail: str) -> str:
    return f"Couldn't install {stem}.zip. {tail}"


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
    msg = _couldnt_install_line(stem, ZIP_UX_CORRUPT_TAIL)
    if prior_version is not None:
        msg += ZIP_UX_CORRUPT_PRIOR_SUFFIX.format(version=prior_version)
    return msg


def zip_rejection_log_message(technical: str) -> str:
    return _LOG_ZIP_REJECTED.replace("%s", (technical or "").strip(), 1)
