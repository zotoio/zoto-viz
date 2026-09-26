from __future__ import annotations

from pathlib import Path


def test_marble_run_work_budget_has_no_pack_relative_sdk_import() -> None:
    text = (
        Path(__file__).resolve().parents[1]
        / "plugins"
        / "src"
        / "marble-run"
        / "frontend"
        / "work-budget.ts"
    ).read_text(encoding="utf-8")
    assert "manifest-work-budget" not in text
    assert "MarbleWorkBudget" in text
