"""visualisation.yml workBudget — shape parse, host clamp, install guard (#45)."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from service import paths
from service.work_budget_policy import (
    WORK_BUDGET_CEILINGS_REL_PATH,
    WORK_BUDGET_LIMITED_NOTE,
    load_work_budget_ceilings,
    reset_work_budget_ceilings_cache,
)

REPO = paths.repo_root()
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
    return load_work_budget_ceilings()


def _field_label(path: str, key: str) -> str:
    return f"{path}.{key}" if path else key


def _plain_whole_number_reason(path: str, key: str) -> str:
    return f"{_field_label(path, key)} must be a whole number that is at least 0"


def parse_manifest_work_budget_shape(raw: Any, path: str = "workBudget") -> dict[str, int]:
    if not isinstance(raw, dict):
        raise ValueError(f"{path} must be a mapping of cap names to whole numbers")
    allowed = set(manifest_work_budget_keys())
    for key in raw:
        if key not in allowed:
            raise ValueError(f"{path} does not allow {key}")
    out: dict[str, int] = {}
    for key in manifest_work_budget_keys():
        if key not in raw:
            raise ValueError(f"{_field_label(path, key)} is required")
        value = raw[key]
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise ValueError(_plain_whole_number_reason(path, key))
        if isinstance(value, float) and not value.is_integer():
            raise ValueError(_plain_whole_number_reason(path, key))
        n = int(value)
        if n < 0:
            raise ValueError(f"{_field_label(path, key)} must be at least 0")
        out[key] = n
    return out


def clamp_manifest_work_budget_at_runtime(budget: dict[str, int]) -> dict[str, int]:
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


def work_budget_exceeds_ceilings(budget: dict[str, int]) -> bool:
    ceilings = manifest_work_budget_ceilings()
    return any(budget.get(k, 0) > ceilings[k] for k in manifest_work_budget_keys())


def ingest_catalog_work_budget(raw: Any) -> tuple[dict[str, int], str | None]:
    """Catalog load: never reject for over-ceiling; clamp and optional operator note."""
    parsed = parse_manifest_work_budget_shape(raw)
    clamped = clamp_manifest_work_budget_at_runtime(parsed)
    note = WORK_BUDGET_LIMITED_NOTE if work_budget_exceeds_ceilings(parsed) else None
    return clamped, note


def assert_work_budget_install_allowed(raw: Any) -> None:
    """New install/update: block only when any field exceeds 10× host ceiling."""
    parsed = parse_manifest_work_budget_shape(raw)
    ceilings = manifest_work_budget_ceilings()
    mult = 10
    for key in manifest_work_budget_keys():
        limit = ceilings[key] * mult
        if parsed[key] > limit:
            raise ValueError(
                f"workBudget.{key} is far above what this monitor allows "
                f"(at most {limit}; the pack asked for {parsed[key]})"
            )


def resolve_work_budget_policy_path(pack_root: Path | None = None) -> Path:
    """Always host install policy — never a path inside a pack tree."""
    return paths.repo_root() / WORK_BUDGET_CEILINGS_REL_PATH
