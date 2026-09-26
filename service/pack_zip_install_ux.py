"""Zip install rejection UX: user copy, server log, prior version lookup."""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

import yaml

from . import paths
from .pack_install_copy import (
    REASON_ZIP_UNSAFE,
    sanitize_zip_display_stem,
    zip_display_stem_from_path,
    zip_rejection_log_message,
    zip_unsafe_user_message,
)

_LOG = logging.getLogger(__name__)


def installed_runtime_version(runtime: Path) -> int | str | None:
    yml = runtime / "plugin.yml"
    if not yml.is_file():
        return None
    try:
        doc = yaml.safe_load(yml.read_text(encoding="utf-8"))
    except (OSError, yaml.YAMLError):
        return None
    if not isinstance(doc, dict):
        return None
    ver = doc.get("version")
    if ver is None:
        return None
    return ver


def runtime_for_display_stem(stem: str) -> Path | None:
    safe = sanitize_zip_display_stem(stem)
    roots = [paths.plugin_local_runtime_dir(create=False), paths.plugin_runtime_dir()]
    for root in roots:
        if not root.is_dir():
            continue
        cand = root / safe
        if cand.is_dir():
            return cand
    return None


def resolve_zip_display_stem(
    *,
    zip_display_name: str | None = None,
    zip_path: str | Path | None = None,
) -> str:
    if zip_display_name:
        from .pack_install_copy import sanitize_zip_display_stem

        return sanitize_zip_display_stem(zip_display_name)
    return zip_display_stem_from_path(zip_path)


def log_zip_install_rejection(technical: str) -> None:
    _LOG.info("%s", zip_rejection_log_message(technical))


def zip_unsafe_blocked_payload(
    technical: str,
    *,
    zip_display_name: str | None = None,
    zip_path: str | Path | None = None,
    pack_id: str = "",
    sha256: str = "",
    prior_version: int | str | None = None,
    runtime: Path | None = None,
) -> dict[str, Any]:
    stem = resolve_zip_display_stem(zip_display_name=zip_display_name, zip_path=zip_path)
    prior = prior_version
    rt = runtime
    if rt is None:
        rt = runtime_for_display_stem(stem)
    if prior is None and rt is not None and rt.is_dir():
        prior = installed_runtime_version(rt)
    log_zip_install_rejection(technical)
    message = zip_unsafe_user_message(stem, technical, prior_version=prior)
    zpath = str(zip_path or "")
    return {
        "ok": False,
        "error": REASON_ZIP_UNSAFE,
        "reason": REASON_ZIP_UNSAFE,
        "message": message,
        "id": pack_id or "",
        "sha256": sha256,
        "zip": zpath,
    }
