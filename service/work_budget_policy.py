"""Host-owned workBudget ceilings (#45). Loaded only from the install tree."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from service import paths

WORK_BUDGET_CEILINGS_REL_PATH = "service/policy/work-budget-ceilings.json"

WORK_BUDGET_LIMITED_NOTE = (
    "This pack asks for more work per frame than this version allows, so it's been limited."
)

_CEILINGS: dict[str, int] | None = None


def work_budget_ceilings_path() -> Path:
    return paths.repo_root() / WORK_BUDGET_CEILINGS_REL_PATH


def load_work_budget_ceilings() -> dict[str, int]:
    global _CEILINGS
    if _CEILINGS is None:
        path = work_budget_ceilings_path()
        raw = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(raw, dict):
            raise ValueError(f"{path} must be a mapping")
        _CEILINGS = {str(k): int(v) for k, v in raw.items()}
    return dict(_CEILINGS)


def reset_work_budget_ceilings_cache() -> None:
    global _CEILINGS
    _CEILINGS = None


def install_reject_multiplier() -> int:
    return 10
