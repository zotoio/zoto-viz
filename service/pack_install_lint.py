"""Install-time pack lint warnings only (blocking runs in bundle-pack-entry.mjs).

#185: the blocking lint fails closed. bundle-pack-entry.mjs exits EXIT_LINT_SETUP with a
``pack-install-lint-setup-error`` JSON line when the lint couldn't run or gave no verdict, and
writes a ``pack-install-lint-pass`` line when it passed. The service refuses an install-lint
bundle that has neither a block nor a pass verdict.
"""
from __future__ import annotations

import json
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


EXIT_LINT_SETUP = 3
REASON_INSTALL_CHECK_UNAVAILABLE = "pack_install_check_unavailable"
_LINT_PASS = "pack-install-lint-pass"
_LINT_SETUP = "pack-install-lint-setup-error"


class PackInstallLintSetupError(ValueError):
    """The install lint couldn't run (or gave no verdict), so the install was refused."""


def format_install_lint_setup_message(name: str) -> str:
    label = (name or "").strip() or "Plugin"
    return f"Couldn't safety-check {label}, so it wasn't installed. Run `pnpm install` in `web/` and try again."


def _verdict_lines(stderr: str, kind: str) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for line in (stderr or "").splitlines():
        text = line.strip()
        if not text.startswith("{"):
            continue
        try:
            raw = json.loads(text)
        except json.JSONDecodeError:
            continue
        if isinstance(raw, dict) and raw.get("type") == kind:
            out.append(raw)
    return out


def install_lint_setup_failed(returncode: int, stderr: str) -> bool:
    return returncode == EXIT_LINT_SETUP or bool(_verdict_lines(stderr, _LINT_SETUP))


def install_lint_passed(stderr: str) -> bool:
    return bool(_verdict_lines(stderr, _LINT_PASS))
