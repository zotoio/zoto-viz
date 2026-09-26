from __future__ import annotations

import base64
import logging

import pytest

from service import mcp as plugin_mcp
from service import pack_install_copy as copy
from service import plugin_local
from service.pack_install_copy import (
    ZIP_UX_CORRUPT_PRIOR_SUFFIX,
    ZIP_UX_CORRUPT_TAIL,
    ZIP_UX_ENCRYPTED_TAIL,
    ZIP_UX_OVERSIZE_TAIL,
    sanitize_zip_display_stem,
    zip_rejection_log_message,
    zip_unsafe_user_message,
)

MINIMAL = "id: sample\nname: Sample\nversion: 1\n"
VIZ = "engine: graph\nbase: topology\n"


def test_zip_ux_literal_corrupt_tail() -> None:
    assert ZIP_UX_CORRUPT_TAIL == "The file isn't a valid pack or is damaged."


def test_zip_ux_literal_corrupt_prior_suffix() -> None:
    assert ZIP_UX_CORRUPT_PRIOR_SUFFIX == ", so version {version} is still installed."


def test_zip_ux_literal_encrypted_tail() -> None:
    assert ZIP_UX_ENCRYPTED_TAIL == "It's password-protected. Zip it again without a password."


def test_zip_ux_literal_oversize_tail() -> None:
    assert ZIP_UX_OVERSIZE_TAIL == "It unpacks to more than packs are allowed."


def test_zip_ux_sanitize_strips_path_and_keeps_markup_plain() -> None:
    stem = sanitize_zip_display_stem("../packs/<img src=x>.zip")
    assert stem == "<img src=x>"
    assert "<" in stem
    assert ".." not in stem
    assert "/" not in stem


def test_zip_ux_user_message_examples() -> None:
    assert zip_unsafe_user_message("unsafe", "not a zip") == (
        "Couldn't install unsafe.zip. The file isn't a valid pack or is damaged."
    )
    assert zip_unsafe_user_message("unsafe", "encrypted entries are not allowed") == (
        "Couldn't install unsafe.zip. It's password-protected. Zip it again without a password."
    )
    assert zip_unsafe_user_message("unsafe", "uncompressed size exceeds 50") == (
        "Couldn't install unsafe.zip. It unpacks to more than packs are allowed."
    )
    assert zip_unsafe_user_message("sample", "duplicate", prior_version=1) == (
        "Couldn't install sample.zip. The file isn't a valid pack or is damaged., so version 1 is still installed."
    )


def test_zip_ux_log_line_exact() -> None:
    technical = "zip entry './plugin.yml': duplicate name (same as 'plugin.yml' after normalization)"
    assert zip_rejection_log_message(technical) == f"pack zip install rejected: {technical}"
