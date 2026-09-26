from __future__ import annotations

import json
import math
from pathlib import Path

import pytest

from service import paths
from service.manifest_work_budget import (
    host_work_budget_ceilings,
    parse_manifest_work_budget_shape,
    runtime_work_budget_int,
)
REPO = paths.repo_root()
SCHEMA = REPO / "plugins" / "sdk" / "manifest-work-budget.schema.json"


def _base_budget() -> dict[str, int]:
    return dict(host_work_budget_ceilings())


@pytest.mark.parametrize(
    "raw,expect_ok",
    [
        ({k: v for k, v in _base_budget().items()}, True),
        ({**_base_budget(), "maxDrawCalls": True}, False),
        ({**_base_budget(), "maxDrawCalls": 5.5}, False),
        ({**_base_budget(), "maxDrawCalls": "5"}, False),
        (None, False),
        ({**_base_budget(), "maxDrawCalls": float("nan")}, False),
        ({**_base_budget(), "maxDrawCalls": float("inf")}, False),
        ({**_base_budget(), "maxDrawCalls": -0}, True),
        ({**_base_budget(), "extraKey": 1}, False),
        ({k: v for k, v in _base_budget().items() if k != "maxPacketsPerFrame"}, False),
    ],
)
def test_python_shape_cases(raw: object, expect_ok: bool) -> None:
    if expect_ok:
        parse_manifest_work_budget_shape(raw)
    else:
        with pytest.raises(ValueError):
            parse_manifest_work_budget_shape(raw)


def test_runtime_clamp_matches_ts_for_nonfinite() -> None:
    assert runtime_work_budget_int(float("nan")) == 0
    assert runtime_work_budget_int(float("inf")) == 0
    assert runtime_work_budget_int(None) == 0


def test_schema_required_keys_match_python_loader() -> None:
    schema = json.loads(SCHEMA.read_text(encoding="utf-8"))
    required = tuple(schema["required"])
    from service.manifest_work_budget import manifest_work_budget_keys

    assert manifest_work_budget_keys() == required
