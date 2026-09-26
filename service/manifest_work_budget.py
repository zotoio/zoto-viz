"""Shared visualisation.yml workBudget validation (#45); reads plugins/sdk/manifest-work-budget.schema.json."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

REPO = Path(__file__).resolve().parents[1]
SCHEMA_PATH = REPO / "plugins" / "sdk" / "manifest-work-budget.schema.json"

_SCHEMA: dict[str, Any] | None = None


def _load_schema() -> dict[str, Any]:
    global _SCHEMA
    if _SCHEMA is None:
        raw = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
        if not isinstance(raw, dict):
            raise ValueError(f"{SCHEMA_PATH} is not a mapping")
        _SCHEMA = raw
    return _SCHEMA


def manifest_work_budget_keys() -> tuple[str, ...]:
    schema = _load_schema()
    required = schema.get("required")
    if not isinstance(required, list):
        raise ValueError("manifest workBudget schema missing required[]")
    return tuple(str(k) for k in required)


def manifest_work_budget_ceilings() -> dict[str, int]:
    schema = _load_schema()
    props = schema.get("properties")
    if not isinstance(props, dict):
        raise ValueError("manifest workBudget schema missing properties")
    out: dict[str, int] = {}
    for key in manifest_work_budget_keys():
        field = props.get(key)
        if not isinstance(field, dict) or "maximum" not in field:
            raise ValueError(f"manifest workBudget schema missing maximum for {key!r}")
        out[key] = int(field["maximum"])
    return out


def _field_label(path: str, key: str) -> str:
    return f"{path}.{key}" if path else key


def _plain_range_reason(path: str, key: str, ceiling: int) -> str:
    return f"{_field_label(path, key)} must be a whole number from 0 to {ceiling}"


def validate_manifest_work_budget(raw: Any, path: str = "workBudget") -> dict[str, int]:
    """Validate workBudget; raise ValueError with a plain-language reason."""
    if not isinstance(raw, dict):
        raise ValueError(f"{path} must be a mapping of cap names to whole numbers")
    ceilings = manifest_work_budget_ceilings()
    allowed = set(manifest_work_budget_keys())
    for key in raw:
        if key not in allowed:
            raise ValueError(f"{path} does not allow {key}")
    out: dict[str, int] = {}
    for key in manifest_work_budget_keys():
        ceiling = ceilings[key]
        if key not in raw:
            raise ValueError(f"{_field_label(path, key)} is required")
        value = raw[key]
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise ValueError(_plain_range_reason(path, key, ceiling))
        if isinstance(value, float) and not value.is_integer():
            raise ValueError(_plain_range_reason(path, key, ceiling))
        n = int(value)
        if n < 0:
            raise ValueError(f"{_field_label(path, key)} must be at least 0")
        if n > ceiling:
            raise ValueError(f"{_field_label(path, key)} must be at most {ceiling} (got {n})")
        out[key] = n
    return out


def clamp_manifest_work_budget_at_runtime(budget: dict[str, int]) -> dict[str, int]:
    """Host clamp so manifests that passed an older schema still cannot exceed ceilings."""
    ceilings = manifest_work_budget_ceilings()
    out: dict[str, int] = {}
    for key in manifest_work_budget_keys():
        raw = budget.get(key, 0)
        if isinstance(raw, bool) or not isinstance(raw, (int, float)):
            n = 0
        else:
            n = int(raw)
        n = max(0, n)
        out[key] = min(n, ceilings[key])
    return out
