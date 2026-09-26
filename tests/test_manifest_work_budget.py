from __future__ import annotations

import pytest

from service.manifest_work_budget import (
    clamp_manifest_work_budget_at_runtime,
    manifest_work_budget_ceilings,
    validate_manifest_work_budget,
)


def _shipped_budget() -> dict[str, int]:
    return dict(manifest_work_budget_ceilings())


def test_rejects_manifest_at_ten_times_ceiling() -> None:
    ceilings = manifest_work_budget_ceilings()
    over = {**_shipped_budget(), "maxDrawCalls": ceilings["maxDrawCalls"] * 10}
    with pytest.raises(ValueError, match=r"must be at most 256 \(got 2560\)"):
        validate_manifest_work_budget(over)


def test_rejects_fraction_negative_and_non_number() -> None:
    base = _shipped_budget()
    with pytest.raises(ValueError, match="whole number from 0 to"):
        validate_manifest_work_budget({**base, "maxTriangles": 1.5})
    with pytest.raises(ValueError, match="at least 0"):
        validate_manifest_work_budget({**base, "maxInstances": -1})
    with pytest.raises(ValueError, match="whole number from 0 to"):
        validate_manifest_work_budget({**base, "maxGpuBytes": "1e9"})
    with pytest.raises(ValueError, match="must be at most 128"):
        validate_manifest_work_budget({**base, "maxPacketsPerFrame": 10**9})


def test_runtime_clamp_direct_call() -> None:
    ceilings = manifest_work_budget_ceilings()
    raw = {
        **_shipped_budget(),
        "maxDrawCalls": ceilings["maxDrawCalls"] + 500,
        "maxPacketsPerFrame": ceilings["maxPacketsPerFrame"] + 99,
    }
    clamped = clamp_manifest_work_budget_at_runtime(raw)
    assert clamped["maxDrawCalls"] == ceilings["maxDrawCalls"]
    assert clamped["maxPacketsPerFrame"] == ceilings["maxPacketsPerFrame"]
