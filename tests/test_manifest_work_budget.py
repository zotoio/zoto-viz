from __future__ import annotations

import json
from pathlib import Path

import pytest
import yaml

from service import paths
from service.manifest_work_budget import (
    assert_work_budget_install_allowed,
    assert_work_budget_over_host_ceiling,
    ingest_catalog_work_budget,
    manifest_work_budget_ceilings,
    parse_manifest_work_budget_shape,
)
from service.plugins import _attach_visualisation
from service.work_budget_policy import (
    WORK_BUDGET_LIMITED_NOTE,
    reset_work_budget_ceilings_cache,
    resolve_work_budget_policy_path,
)

REPO = paths.repo_root()
POLICY = REPO / "service" / "policy" / "work-budget-ceilings.json"
PARITY_FIXTURE = REPO / "tests" / "fixtures" / "work-budget-policy-parity.json"


def _full_budget(**over: int) -> dict[str, int]:
    return {**manifest_work_budget_ceilings(), **over}


def _install_blocked(raw: dict[str, int], pack_root: Path | None = None) -> bool:
    try:
        assert_work_budget_install_allowed(raw, pack_root=pack_root)
    except ValueError:
        return True
    return False


def test_install_blocks_at_ten_times_ceiling() -> None:
    ceilings = manifest_work_budget_ceilings()
    absurd = _full_budget(maxDrawCalls=ceilings["maxDrawCalls"] * 10 + 1)
    assert _install_blocked(absurd) is True


def test_install_blocks_despite_pack_bundled_policy_ceilings(tmp_path: Path) -> None:
    host = manifest_work_budget_ceilings()
    pack = tmp_path / "zip-pack"
    policy_dir = pack / "service" / "policy"
    policy_dir.mkdir(parents=True)
    inflated = {key: host[key] * 1000 for key in host}
    (policy_dir / "work-budget-ceilings.json").write_text(json.dumps(inflated), encoding="utf-8")
    (pack / "visualisation.yml").write_text(
        yaml.safe_dump(
            {
                "engine": "graph",
                "workBudget": _full_budget(maxDrawCalls=host["maxDrawCalls"] * 10 + 1),
            },
            sort_keys=False,
        ),
        encoding="utf-8",
    )
    assert _install_blocked(
        _full_budget(maxDrawCalls=host["maxDrawCalls"] * 10 + 1),
        pack_root=pack,
    ) is True


def test_catalog_clamps_without_blocking() -> None:
    clamped, note = ingest_catalog_work_budget(_full_budget(maxSimStepsPerFrame=99))
    assert clamped["maxSimStepsPerFrame"] == manifest_work_budget_ceilings()["maxSimStepsPerFrame"]
    assert note == WORK_BUDGET_LIMITED_NOTE


def test_catalog_clamps_over_ceiling_pack_stays_loaded(tmp_path: Path) -> None:
    home = tmp_path / "pack"
    home.mkdir()
    wb = _full_budget(maxSimStepsPerFrame=99)
    (home / "visualisation.yml").write_text(
        yaml.safe_dump({"engine": "graph", "workBudget": wb}, sort_keys=False),
        encoding="utf-8",
    )
    errors: list[dict[str, str]] = []
    row = _attach_visualisation({"id": "local-pack"}, home, errors, "pack/visualisation.yml")
    assert errors == []
    assert row["workBudget"]["maxSimStepsPerFrame"] == manifest_work_budget_ceilings()["maxSimStepsPerFrame"]
    assert row["workBudgetLimited"] == WORK_BUDGET_LIMITED_NOTE


def test_policy_path_is_host_install_not_pack(tmp_path: Path) -> None:
    pack = tmp_path / "fake-pack"
    pack.mkdir()
    (pack / "service" / "policy").mkdir(parents=True)
    (pack / "service" / "policy" / "work-budget-ceilings.json").write_text(
        json.dumps({"maxDrawCalls": 999999}), encoding="utf-8"
    )
    assert resolve_work_budget_policy_path(pack).resolve() == POLICY.resolve()


def test_parity_fixture_both_validators_reject_over_raised_ceiling() -> None:
    fixture = json.loads(PARITY_FIXTURE.read_text(encoding="utf-8"))
    work_budget = fixture["workBudget"]
    original = json.loads(POLICY.read_text(encoding="utf-8"))
    raised = {**original, "maxDrawCalls": 128}
    POLICY.write_text(json.dumps(raised), encoding="utf-8")
    reset_work_budget_ceilings_cache()
    try:
        rejected = False
        try:
            assert_work_budget_over_host_ceiling(work_budget)
        except ValueError:
            rejected = True
        assert rejected is True
        assert work_budget["maxDrawCalls"] > raised["maxDrawCalls"]
    finally:
        POLICY.write_text(json.dumps(original), encoding="utf-8")
        reset_work_budget_ceilings_cache()


def test_lowered_ceiling_clamps_installed_catalog_row() -> None:
    original = json.loads(POLICY.read_text(encoding="utf-8"))
    lowered = {**original, "maxPacketsPerFrame": 2}
    POLICY.write_text(json.dumps(lowered), encoding="utf-8")
    reset_work_budget_ceilings_cache()
    try:
        clamped, note = ingest_catalog_work_budget(_full_budget(maxPacketsPerFrame=8))
        assert clamped["maxPacketsPerFrame"] == 2
        assert note == WORK_BUDGET_LIMITED_NOTE
    finally:
        POLICY.write_text(json.dumps(original), encoding="utf-8")
        reset_work_budget_ceilings_cache()
