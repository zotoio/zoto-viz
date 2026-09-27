from __future__ import annotations

import base64
import logging

import pytest

from service import mcp as plugin_mcp
from service import pack_install_copy as copy
from service import plugin_local
from service.pack_zip_install_ux import zip_unsafe_blocked_payload
from service.pack_install_copy import (
    BLOCKED_MESSAGE,
    FAULT_MESSAGE,
    UPGRADE_ROLLBACK_UX_MESSAGE,
    ZIP_UX_CORRUPT_PRIOR_SUFFIX,
    ZIP_UX_CORRUPT_TAIL,
    ZIP_UX_DROP_ALREADY_EXISTS_TAIL,
    ZIP_UX_DROP_SCHEMA_TAIL,
    ZIP_UX_ENCRYPTED_TAIL,
    ZIP_UX_INSTALL_FAILED,
    ZIP_UX_OVERSIZE_TAIL,
    blocked_message,
    drop_zone_already_exists_install_message,
    drop_zone_schema_install_message,
    fault_message,
    sanitize_manifest_display_text,
    sanitize_zip_display_stem,
    upgrade_rollback_user_message,
    zip_rejection_log_message,
    zip_unsafe_user_message,
)

MINIMAL = "id: sample\nname: Sample\nversion: 1\n"
VIZ = "engine: graph\nbase: topology\n"

def _ux_literal(actual: str, expected: str, label: str) -> None:
    assert (actual == expected) is True, label

def test_zip_ux_literal_corrupt_tail() -> None:
    _ux_literal(ZIP_UX_CORRUPT_TAIL, "The file isn't a valid pack or is damaged.", "zip ux corrupt tail")

def test_zip_ux_literal_corrupt_prior_suffix() -> None:
    _ux_literal(
        ZIP_UX_CORRUPT_PRIOR_SUFFIX,
        ", so version {version} is still installed.",
        "zip ux corrupt prior suffix",
    )

def test_zip_ux_literal_encrypted_tail() -> None:
    _ux_literal(
        ZIP_UX_ENCRYPTED_TAIL,
        "It's password-protected. Zip it again without a password.",
        "zip ux encrypted tail",
    )

def test_zip_ux_literal_oversize_tail() -> None:
    _ux_literal(ZIP_UX_OVERSIZE_TAIL, "It unpacks to more than packs are allowed.", "zip ux oversize tail")

def test_zip_ux_sanitize_strips_path_and_keeps_markup_plain() -> None:
    raw = "../packs/<img src=x>"
    stem = sanitize_zip_display_stem(f"{raw}.zip")
    assert stem == "<img src=x>"
    assert sanitize_manifest_display_text(raw) == "<img src=x>"
    assert "<" in stem
    assert ".." not in stem
    assert "/" not in stem

def test_zip_ux_literal_upgrade_rollback_message() -> None:
    _ux_literal(
        UPGRADE_ROLLBACK_UX_MESSAGE,
        "Couldn't update {name} to version {new_version}, so version {old_version} is still installed. "
        "Try again, and if it keeps failing, check the server log.",
        "zip ux upgrade rollback template",
    )

def test_zip_ux_upgrade_rollback_example() -> None:
    assert upgrade_rollback_user_message("Sample", 2, 1) == (
        "Couldn't update Sample to version 2, so version 1 is still installed. "
        "Try again, and if it keeps failing, check the server log."
    )

def test_zip_ux_literal_install_failed_template() -> None:
    _ux_literal(ZIP_UX_INSTALL_FAILED, "Couldn't install {stem}.zip. {tail}", "zip ux install failed template")

def test_zip_ux_literal_blocked_message_template() -> None:
    _ux_literal(
        BLOCKED_MESSAGE,
        "{label} was blocked. {body} Nothing was installed and the current wall is unchanged.",
        "zip ux blocked message template",
    )

def test_zip_ux_literal_fault_message_template() -> None:
    _ux_literal(
        FAULT_MESSAGE,
        "Packs can't be installed right now because the list of installed packs couldn't be read. {detail}",
        "zip ux fault message template",
    )

def test_zip_ux_literal_drop_schema_tail() -> None:
    assert ZIP_UX_DROP_SCHEMA_TAIL == "The plugin id in this pack isn't valid."

def test_zip_ux_literal_drop_already_exists_tail() -> None:
    assert ZIP_UX_DROP_ALREADY_EXISTS_TAIL == "This pack is already in the drop zone."

def test_zip_ux_drop_schema_install_message_example() -> None:
    assert drop_zone_schema_install_message("my-pack") == (
        "Couldn't install my-pack.zip. The plugin id in this pack isn't valid."
    )

def test_zip_ux_drop_already_exists_install_message_example() -> None:
    assert drop_zone_already_exists_install_message("alt-name") == (
        "Couldn't install alt-name.zip. This pack is already in the drop zone."
    )

def test_zip_ux_corrupt_prior_installed_example() -> None:
    _ux_literal(
        zip_unsafe_user_message("sample", "not a zip", prior_version=1),
        "Couldn't install sample.zip. The file isn't a valid pack or is damaged, so version 1 is still installed.",
        "zip ux corrupt prior installed example",
    )

def test_zip_ux_blocked_message_example() -> None:
    assert blocked_message("Sample", "bad import.") == (
        "Sample was blocked. bad import. Nothing was installed and the current wall is unchanged."
    )

def test_zip_ux_fault_message_example() -> None:
    assert fault_message("The store file is missing.") == (
        "Packs can't be installed right now because the list of installed packs couldn't be read. "
        "The store file is missing."
    )

def test_zip_ux_api_unsafe_corrupt_message() -> None:
    payload = zip_unsafe_blocked_payload("not a zip", zip_display_name="pack")
    assert payload["ok"] is False
    assert payload["error"] == "pack_zip_unsafe"
    assert payload["message"] == "Couldn't install pack.zip. The file isn't a valid pack or is damaged."


def test_zip_ux_api_unsafe_encrypted_message() -> None:
    payload = zip_unsafe_blocked_payload(
        "encrypted entries are not allowed",
        zip_display_name="unsafe",
    )
    assert payload["message"] == (
        "Couldn't install unsafe.zip. It's password-protected. Zip it again without a password."
    )


def test_zip_ux_api_unsafe_oversize_message() -> None:
    payload = zip_unsafe_blocked_payload(
        "uncompressed size exceeds 50",
        zip_display_name="unsafe",
    )
    assert payload["message"] == "Couldn't install unsafe.zip. It unpacks to more than packs are allowed."


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
        "Couldn't install sample.zip. The file isn't a valid pack or is damaged, so version 1 is still installed."
    )

def test_zip_ux_log_line_exact() -> None:
    technical = "zip entry './plugin.yml': duplicate name (same as 'plugin.yml' after normalization)"
    assert zip_rejection_log_message(technical) == f"pack zip install rejected: {technical}"
