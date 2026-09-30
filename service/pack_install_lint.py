"""Install-time pack lint warnings only (blocking runs in bundle-pack-entry.mjs).

#185: the blocking lint fails closed. bundle-pack-entry.mjs exits EXIT_LINT_SETUP with a
``pack-install-lint-setup-error`` JSON line when the lint couldn't run or gave no verdict. On a pass
its LAST stderr line is exactly ``{"type":"pack-install-lint-pass","nonce":<service nonce>,
"pack":<pack id>}``; the service generates the nonce per run (``ZOTO_PACK_INSTALL_LINT_NONCE``) and
refuses an install-lint run that doesn't end in that line with exit 0.
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


NONCE_ENV = "ZOTO_PACK_INSTALL_LINT_NONCE"


class PackInstallLintSetupError(ValueError):
    """The install lint couldn't run (or gave no valid verdict), so the install was refused.

    ``str(e)`` is the fresh-install copy; upgrades re-word it with
    :func:`format_install_lint_setup_upgrade_message` (they know the installed version).
    """

    def __init__(self, pack_name: str, reason: str = "") -> None:
        self.pack_name = (pack_name or "").strip() or "Plugin"
        #: #186: machine-readable cause for the log and tests (``lint_prebuilt_missing``,
        #: ``lint_prebuilt_stale``, ``esbuild_unresolvable``, …); never user text.
        self.reason = reason
        super().__init__(format_install_lint_setup_message(self.pack_name))


def format_install_lint_setup_message(name: str) -> str:
    label = (name or "").strip() or "Plugin"
    return f"Couldn't safety-check {label}, so it wasn't installed. Run `pnpm install` in `web/` and try again."


def format_install_lint_setup_upgrade_message(name: str, old_version: str | int | None) -> str:
    label = (name or "").strip() or "Plugin"
    old = str(old_version).strip() if old_version is not None else ""
    still = f"You're still on v{old}." if old else "You're still on the version you had."
    return (
        f"Couldn't safety-check the new version of {label}, so it wasn't updated. {still} "
        "Run `pnpm install` in `web/` and try again."
    )


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


def install_lint_setup_reason(stderr: str) -> str:
    """#186: the ``reason`` code of the script's setup-error line ("" when it has none)."""
    lines = _verdict_lines(stderr, _LINT_SETUP)
    return str(lines[-1].get("reason") or "") if lines else ""


def install_lint_setup_failed(returncode: int, stderr: str) -> bool:
    return returncode == EXIT_LINT_SETUP or bool(_verdict_lines(stderr, _LINT_SETUP))


def install_lint_passed(returncode: int, stderr: str, *, nonce: str, pack: str) -> bool:
    """Exit 0 and the LAST non-empty stderr line is exactly {type: pass, nonce, pack}."""
    if returncode != 0 or not nonce:
        return False
    lines = [ln.strip() for ln in (stderr or "").splitlines() if ln.strip()]
    if not lines:
        return False
    try:
        raw = json.loads(lines[-1])
    except json.JSONDecodeError:
        return False
    return raw == {"type": _LINT_PASS, "nonce": nonce, "pack": pack}
