from __future__ import annotations

import json
from pathlib import Path

import pytest

from service import plugins
from service.pack_sdk_contract import format_sdk_mismatch_message, host_sdk_contract_version


def _fixture_home() -> Path:
    return Path(__file__).resolve().parents[1] / "plugins/sdk/pack-sdk-fixtures/stale-contract"


def test_host_reads_pack_sdk_contract_version() -> None:
    assert host_sdk_contract_version() >= 1


def test_scan_blocks_stale_sdk_manifest(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    repo = tmp_path / "checkout"
    src = repo / "plugins" / "src" / "pack-sdk-stale-contract"
    src.mkdir(parents=True)
    fixture = _fixture_home()
    for name in ("plugin.yml", "pack-build.manifest.json"):
        (src / name).write_text((fixture / name).read_text(encoding="utf-8"), encoding="utf-8")
    (src / "frontend").mkdir()
    (src / "frontend/index.ts").write_text(
        (fixture / "frontend/index.ts").read_text(encoding="utf-8"),
        encoding="utf-8",
    )
    monkeypatch.setenv("ZOTO_VIZ_REPO_ROOT", str(repo))
    plugins.reset_bundles()
    result = plugins.scan(repo)
    ids = {p["id"] for p in result["plugins"]}
    assert "pack-sdk-stale-contract" in ids
    blocked = [e for e in result["errors"] if e.get("error") == "pack_sdk_contract"]
    assert not blocked
    row = next(p for p in result["plugins"] if p["id"] == "pack-sdk-stale-contract")
    assert row.get("hash")


def test_format_sdk_mismatch_message() -> None:
    text = format_sdk_mismatch_message("Koi", 0, 1)
    assert "Koi was blocked" in text
    assert "older zoto-viz SDK" in text
