"""Install-time pack lint warnings only (blocking runs in bundle-pack-entry.mjs)."""
from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from .pack_lint_mask import mask_ts_comments

_WARNINGS: tuple[tuple[str, re.Pattern[str], str], ...] = (
    (
        "inline-zoto-declare",
        re.compile(r"\bdeclare\s+const\s+zoto\b"),
        "Use getVizZoto() instead of declare const zoto.",
    ),
    (
        "pack-zoto-binding",
        re.compile(r"(?:^|[^\w])const\s+zoto\s*="),
        "Use getVizZoto() instead of binding const zoto.",
    ),
)


def _ts_files(home: Path) -> list[Path]:
    out: list[Path] = []
    for path in home.rglob("*.ts"):
        if path.is_symlink():
            continue
        if path.name.endswith(".d.ts"):
            continue
        out.append(path)
    return out


def run_install_pack_lint(home: Path) -> tuple[list[str], list[str]]:
    """Return (blocking_reasons, warning_messages). Blocking is always empty here."""
    warnings: list[str] = []
    for path in _ts_files(home):
        try:
            text = path.read_text(encoding="utf-8")
        except OSError:
            continue
        code = mask_ts_comments(text)
        for _rule, pattern, detail in _WARNINGS:
            if pattern.search(code):
                warnings.append(detail)
    return [], warnings


def merge_lint_warnings(doc: dict[str, Any], warnings: list[str]) -> dict[str, Any]:
    if not warnings:
        return doc
    merged = dict(doc)
    prev = merged.get("installLintWarnings")
    if isinstance(prev, list):
        merged["installLintWarnings"] = list(dict.fromkeys([*prev, *warnings]))
    else:
        merged["installLintWarnings"] = list(dict.fromkeys(warnings))
    return merged
