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
#: #186: the lint ran out of time. lint_timeout: bundle-pack-entry.mjs's own timer (on its setup-error
#: line). bundle_timeout: the service's backstop (PACK_BUNDLE_TIMEOUT_S) killed the group because the
#: script never said so. Two codes so reports can tell which kill fired; one sentence (the table's
#: reason_overrides points both at the same templates).
REASON_LINT_TIMEOUT = "lint_timeout"
REASON_BUNDLE_TIMEOUT = "bundle_timeout"
_LINT_PASS = "pack-install-lint-pass"
_LINT_SETUP = "pack-install-lint-setup-error"


NONCE_ENV = "ZOTO_PACK_INSTALL_LINT_NONCE"


#: #186: the one table for the setup-refusal copy, shared with bundle-pack-entry.mjs (through
#: web/scripts/pack-install-lint-setup-copy.mjs). Read once at import: it's a tracked file of this
#: checkout, like web/scripts/bundle-pack-entry.mjs itself.
SETUP_COPY_PATH = Path(__file__).resolve().parents[1] / "web" / "scripts" / "pack-install-lint-setup-copy.json"
SETUP_COPY: dict[str, Any] = json.loads(SETUP_COPY_PATH.read_text(encoding="utf-8"))
_PLACEHOLDER = re.compile(r"\{(\w+)\}")


def _fill(template: str, values: dict[str, str]) -> str:
    """One pass, like the script's renderer: a placeholder inside a value is never expanded."""
    return _PLACEHOLDER.sub(lambda m: values.get(m.group(1), m.group(0)), template)


def setup_fix(reason: str | None) -> str:
    """The fix sentence for a setup reason code ("" or an unlisted code: the table's default)."""
    key = SETUP_COPY["reasons"].get(reason or "", SETUP_COPY["default"])
    return str(SETUP_COPY["fixes"][key])


def setup_template(kind: str, reason: str | None) -> str:
    """The table's ``kind`` template ("install" / "upgrade") for a reason: the ``overrides`` entry its
    ``reason_overrides`` names, else the shared one."""
    name = SETUP_COPY.get("reason_overrides", {}).get(reason or "")
    own = SETUP_COPY.get("overrides", {}).get(name) if isinstance(name, str) else None
    if isinstance(own, dict) and isinstance(own.get(kind), str):
        return str(own[kind])
    return str(SETUP_COPY[kind])


class PackInstallLintSetupError(ValueError):
    """The install lint couldn't run (or gave no valid verdict), so the install was refused.

    ``str(e)`` is the fresh-install copy; upgrades re-word it with
    :func:`format_install_lint_setup_upgrade_message` (they know the installed version).
    """

    def __init__(self, pack_name: str, reason: str = "") -> None:
        self.pack_name = (pack_name or "").strip() or "Plugin"
        #: #186: machine-readable cause for the log and tests (``lint_prebuilt_missing``,
        #: ``lint_prebuilt_stale``, ``esbuild_unresolvable``, …); never user text. It picks the fix
        #: sentence from SETUP_COPY.
        self.reason = reason
        super().__init__(format_install_lint_setup_message(self.pack_name, reason))


def format_install_lint_setup_message(name: str, reason: str = "") -> str:
    label = (name or "").strip() or "Plugin"
    return _fill(setup_template("install", reason), {"name": label, "fix": setup_fix(reason)})


def _still(old_version: str | int | None) -> str:
    """The table's "which version is still installed" sentence ("still_unknown" without a version)."""
    old = str(old_version).strip() if old_version is not None else ""
    return _fill(str(SETUP_COPY["still"]), {"old": old}) if old else str(SETUP_COPY["still_unknown"])


def format_install_lint_setup_upgrade_message(name: str, old_version: str | int | None, reason: str = "") -> str:
    label = (name or "").strip() or "Plugin"
    return _fill(setup_template("upgrade", reason), {"name": label, "still": _still(old_version), "fix": setup_fix(reason)})


def format_update_refused_message(name: str, old_version: str | int | None) -> str:
    """#111: an update refused because its safety check couldn't run at all (UX Pro's sentence: the
    table's ``overrides.update_refused.upgrade``; no fix to offer). Sent with reasonCode
    ``update_refused``; nothing branches on this text."""
    label = (name or "").strip() or "Plugin"
    template = str(SETUP_COPY["overrides"]["update_refused"]["upgrade"])
    return _fill(template, {"name": label, "still": _still(old_version)})


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
