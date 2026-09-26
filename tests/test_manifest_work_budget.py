from __future__ import annotations

import json
from pathlib import Path

import pytest
import yaml

from service import paths
from service.manifest_work_budget import (
    assert_work_budget_install_allowed,
    clamp_manifest_work_budget_at_runtime,
    ingest_catalog_work_budget,
    manifest_work_budget_ceilings,
    parse_manifest_work_budget_shape,
    resolve_work_budget_policy_path,
    reset_work_budget_ceilings_cache,
)
from service.work_budget_policy import WORK_BUDGET_LIMITED_NOTE, reset_work_budget_ceilings_cache as reset_policy

REPO = paths.repo_root()
POLICY = REPO / "service" / "policy" / "work-budget-ceilings.json"


def _full_budget(**over: int) -> dict[str, int]:
    return {**manifest_work_budget_ceilings(), **over}


def test_install_blocks_at_ten_times_ceiling() -> None:
    ceilings = manifest_work_budget_ceilings()
    absurd = _full_budget(maxDrawCalls=ceilings["maxDrawCalls"] * 10 + 1)
    with pytest.raises(ValueError, match="far above what this monitor allows"):
        assert_work_budget_install_allowed(absurd)


def test_catalog_clamps_without_blocking() -> None:
    clamped, note = ingest_catalog_work_budget(_full_budget(maxSimStepsPerFrame=99))
    assert clamped["maxSimStepsPerFrame"] == manifest_work_budget_ceilings()["maxSimStepsPerFrame"]
    assert note == WORK_BUDGET_LIMITED_NOTE


def test_policy_path_is_host_install_not_pack(tmp_path: Path) -> None:
    pack = tmp_path / "fake-pack"
    pack.mkdir()
    (pack / "service" / "policy").mkdir(parents=True)
    (pack / "service" / "policy" / "work-budget-ceilings.json").write_text(
        json.dumps({"maxDrawCalls": 999999}), encoding="utf-8"
    )
    assert resolve_work_budget_policy_path(pack).resolve() == POLICY.resolve()


def test_ts_and_python_share_policy_fixture() -> None:
    policy_ceilings = json.loads(POLICY.read_text(encoding="utf-8"))
    fixture = _full_budget(maxTriangles=int(policy_ceilings["maxTriangles"]) + 50)
    clamped_py = clamp_manifest_work_budget_at_runtime(parse_manifest_work_budget_shape(fixture))
    assert clamped_py["maxTriangles"] == int(policy_ceilings["maxTriangles"])


def test_lowered_ceiling_clamps_installed_catalog_row() -> None:
    original = json.loads(POLICY.read_text(encoding="utf-8"))
    lowered = {**original, "maxPacketsPerFrame": 2}
    POLICY.write_text(json.dumps(lowered), encoding="utf-8")
    reset_work_budget_ceilings_cache()
    reset_policy()
    try:
        clamped, note = ingest_catalog_work_budget(_full_budget(maxPacketsPerFrame=8))
        assert clamped["maxPacketsPerFrame"] == 2
        assert note == WORK_BUDGET_LIMITED_NOTE
    finally:
        POLICY.write_text(json.dumps(original), encoding="utf-8")
        reset_work_budget_ceilings_cache()
        reset_policy()


def test_scan_catalog_ingest_via_visualisation_doc(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    from service.plugins import _visualisation_doc

    home = tmp_path / "pack"
    home.mkdir()
    wb = _full_budget(maxSimStepsPerFrame=99)
    (home / "visualisation.yml").write_text(
        yaml.safe_dump({"engine": "graph", "workBudget": wb}, sort_keys=False),
        encoding="utf-8",
    )
    viz = _visualisation_doc(home)
    assert viz is not None
    assert viz["workBudget"]["maxSimStepsPerFrame"] == manifest_work_budget_ceilings()["maxSimStepsPerFrame"]
