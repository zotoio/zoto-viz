from __future__ import annotations

import json
from pathlib import Path

import pytest

from service import paths
from service.pack_install_retry import format_unreadable_block_records_notice
from service.pack_zip_blocks import (
    MESSAGE_BLOCK_RECORD_UNREADABLE,
    REASON_BLOCK_RECORD_UNREADABLE,
    _invalidate_cache,
    clear_zip_block,
    record_zip_block,
    reset_zip_blocks_for_tests,
    row_for_start_failure,
    unreadable_block_record_count,
    zip_block_for_pack,
    zip_block_for_sha,
)


@pytest.fixture(autouse=True)
def _clean_blocks() -> None:
    reset_zip_blocks_for_tests()


def _blocks_dir() -> Path:
    return paths.plugin_local_dir(create=True) / "blocks"


def test_truncated_block_record_quarantines_one_pack_only() -> None:
    static_sha = "a" * 64
    failed_sha = "b" * 64
    changed_sha = "c" * 64

    record_zip_block(
        static_sha,
        {
            "id": "static-pack",
            "error": "pack_boundary",
            "message": "static check failed",
            "name": "Static",
            "zip": "/tmp/static.zip",
            "sha256": static_sha,
            "retryable": "true",
        },
    )
    record_zip_block(
        failed_sha,
        row_for_start_failure(
            sha256=failed_sha,
            message="Failed start",
            pack_id="failed-start",
            name="Failed",
            zip_path="/tmp/failed.zip",
            version=2,
        ),
    )
    record_zip_block(
        changed_sha,
        {
            "id": "zip-changed",
            "error": "pack_install_start_failed",
            "blockReason": "couldnt_start",
            "message": "Zip changed pack has changed since it was blocked.",
            "name": "Changed",
            "zip": "/tmp/changed.zip",
            "sha256": changed_sha,
            "retryable": "true",
        },
    )

    failed_path = _blocks_dir() / "failed-start.json"
    failed_path.write_text("{", encoding="utf-8")
    _invalidate_cache()

    failed_row = zip_block_for_pack("failed-start")
    assert failed_row is not None
    assert failed_row.get("blockReason") == REASON_BLOCK_RECORD_UNREADABLE
    assert failed_row.get("message") == MESSAGE_BLOCK_RECORD_UNREADABLE

    static_row = zip_block_for_pack("static-pack")
    assert static_row is not None
    assert static_row.get("message") == "static check failed"
    assert zip_block_for_sha(static_sha) is not None

    changed_row = zip_block_for_pack("zip-changed")
    assert changed_row is not None
    assert "changed since" in str(changed_row.get("message") or "")
    assert zip_block_for_sha(changed_sha) is not None

    assert unreadable_block_record_count() == 1
    assert format_unreadable_block_records_notice(1).startswith("1 blocked install record")


def test_block_write_crash_before_rename_keeps_prior_record(monkeypatch: pytest.MonkeyPatch) -> None:
    sha_v1 = "d" * 64
    sha_v2 = "e" * 64
    pid = "upgrade-probe"
    record_zip_block(
        sha_v1,
        row_for_start_failure(
            sha256=sha_v1,
            message="v2 couldn't start",
            pack_id=pid,
            name="Probe",
            zip_path="/tmp/probe.zip",
            version=2,
        ),
    )

    def crash() -> None:
        raise RuntimeError("simulated crash before rename")

    monkeypatch.setattr("service.pack_zip_blocks._after_block_write_before_replace", crash)
    with pytest.raises(RuntimeError, match="simulated crash"):
        record_zip_block(
            sha_v2,
            row_for_start_failure(
                sha256=sha_v2,
                message="v3 couldn't start",
                pack_id=pid,
                name="Probe",
                zip_path="/tmp/probe.zip",
                version=3,
            ),
        )
    monkeypatch.setattr("service.pack_zip_blocks._after_block_write_before_replace", None)

    row = zip_block_for_sha(sha_v1)
    assert row is not None
    assert row.get("sha256") == sha_v1
    assert zip_block_for_sha(sha_v2) is None


def test_legacy_single_file_store_migrates_to_per_pack_files() -> None:
    legacy = paths.plugin_local_dir(create=True) / ".zip-install-blocks.json"
    digest = "f" * 64
    legacy.write_text(
        json.dumps(
            {
                "bySha256": {
                    digest: {
                        "id": "legacy-pack",
                        "sha256": digest,
                        "message": "legacy block",
                        "blockReason": "couldnt_start",
                        "error": "pack_install_start_failed",
                        "retryable": "true",
                    },
                },
            },
        )
        + "\n",
        encoding="utf-8",
    )
    hit = zip_block_for_sha(digest)
    assert hit is not None
    assert hit.get("message") == "legacy block"
    assert (_blocks_dir() / "legacy-pack.json").is_file()
    assert not legacy.is_file()


def test_clear_zip_block_removes_pack_file() -> None:
    digest = "9" * 64
    record_zip_block(
        digest,
        row_for_start_failure(
            sha256=digest,
            message="blocked",
            pack_id="clear-me",
            name="Clear",
            zip_path="/tmp/clear.zip",
            version=2,
        ),
    )
    assert clear_zip_block(digest) is True
    assert zip_block_for_sha(digest) is None
    assert not (_blocks_dir() / "clear-me.json").is_file()
