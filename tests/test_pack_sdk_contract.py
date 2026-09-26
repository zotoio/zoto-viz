from __future__ import annotations

import json
from pathlib import Path

import pytest

from service.pack_sdk_contract import format_sdk_mismatch_message, host_sdk_contract_version


def test_host_reads_pack_sdk_contract_version() -> None:
    assert host_sdk_contract_version() >= 1


def test_format_sdk_mismatch_message() -> None:
    text = format_sdk_mismatch_message("Koi", 0, 1)
    assert "Koi was blocked" in text
    assert "older zoto-viz SDK" in text
