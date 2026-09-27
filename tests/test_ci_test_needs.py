from __future__ import annotations

from pathlib import Path

import yaml

from scripts.check_ci_test_needs import check_ci_workflow, validate_ci_test_needs

FIXTURES = Path(__file__).resolve().parent / "fixtures" / "ci-workflows"
REPO_CI = Path(__file__).resolve().parents[1] / ".github" / "workflows" / "ci.yml"


def test_validate_fixture_valid() -> None:
    doc = yaml.safe_load((FIXTURES / "valid-gate.yml").read_text(encoding="utf-8"))
    assert validate_ci_test_needs(doc) == []


def test_validate_fixture_missing_job_in_needs() -> None:
    doc = yaml.safe_load((FIXTURES / "missing-from-needs.yml").read_text(encoding="utf-8"))
    errors = validate_ci_test_needs(doc)
    assert any("missing: docs" in e for e in errors)


def test_validate_fixture_extra_unknown_in_needs() -> None:
    doc = yaml.safe_load((FIXTURES / "extra-in-needs.yml").read_text(encoding="utf-8"))
    errors = validate_ci_test_needs(doc)
    assert any("unknown jobs: phantom" in e for e in errors)


def test_check_real_ci_workflow() -> None:
    assert check_ci_workflow(REPO_CI) == 0
