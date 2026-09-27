"""Host-owned workBudget ceilings (#45). Loaded only from the install tree."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from service import paths

WORK_BUDGET_CEILINGS_REL_PATH = "service/policy/work-budget-ceilings.json"

_NOTE_PATH = paths.repo_root() / "plugins" / "sdk" / "work-budget-limited-note.json"


def _load_limited_note() -> str:
    raw = json.loads(_NOTE_PATH.read_text(encoding="utf-8"))
    if not isinstance(raw, dict) or not isinstance(raw.get("note"), str):
        raise ValueError(f"{_NOTE_PATH} must contain a string note")
    return raw["note"]


WORK_BUDGET_LIMITED_NOTE = _load_limited_note()

_CEILINGS: dict[str, int] | None = None


def work_budget_ceilings_path() -> Path:
    return paths.repo_root() / WORK_BUDGET_CEILINGS_REL_PATH


def _read_ceilings_file(path: Path) -> dict[str, int]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(raw, dict):
        raise ValueError(f"{path} must be a mapping")
    return {str(k): int(v) for k, v in raw.items()}


def resolve_work_budget_policy_path(pack_root: Path | None = None) -> Path:
    """Host install policy only (pack_root ignored in production)."""
    return paths.repo_root() / WORK_BUDGET_CEILINGS_REL_PATH


def load_work_budget_ceilings(pack_root: Path | None = None) -> dict[str, int]:
    path = resolve_work_budget_policy_path(pack_root)
    if pack_root is not None:
        return _read_ceilings_file(path)
    global _CEILINGS
    if _CEILINGS is None:
        _CEILINGS = _read_ceilings_file(path)
    return dict(_CEILINGS)


def reset_work_budget_ceilings_cache() -> None:
    global _CEILINGS
    _CEILINGS = None


def install_reject_multiplier() -> int:
    return 10
