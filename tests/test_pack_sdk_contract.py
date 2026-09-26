from __future__ import annotations

import json
from pathlib import Path

import pytest

from service.pack_sdk_contract import catalog_sdk_contract_error, host_sdk_contract_version


def test_host_reads_pack_sdk_contract_version() -> None:
    assert host_sdk_contract_version() == 1


def test_catalog_sdk_contract_error_older_pack() -> None:
    err = catalog_sdk_contract_error("plugins/src/koi/plugin.yml", {"id": "koi", "name": "Koi"}, 0, 1)
    assert err["message"] == (
        "Koi was blocked: Built for an older zoto-viz SDK — needs an update from its author. "
        "Nothing else changed."
    )
