"""#186: the install-lint setup-refusal copy has one source, and the service and the script agree on it.

web/scripts/pack-install-lint-setup-copy.json is the table: reason code -> fix sentence, plus the
fresh-install and upgrade templates (and, for a reason whose sentence doesn't fit them, that reason's
own templates in `overrides`, named by `reason_overrides`: lint_timeout and bundle_timeout). service/pack_install_lint.py and
web/scripts/pack-install-lint-setup-copy.mjs (which bundle-pack-entry.mjs uses) both read it. These rows
fail if the two render any entry differently, if a reason the script can emit isn't in the table, or
if either side carries a copy of the wording of its own.
"""
from __future__ import annotations

import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

from service import pack_install_lint as pil
from service.pack_install_lint import SETUP_COPY_PATH, format_install_lint_setup_message

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "web" / "scripts"
TABLE = SCRIPTS / "pack-install-lint-setup-copy.json"
COPY_MODULE = SCRIPTS / "pack-install-lint-setup-copy.mjs"
BUNDLE_SCRIPT = SCRIPTS / "bundle-pack-entry.mjs"
#: Reasons only the service emits (not on the script's setup-error line). bundle_timeout: the backstop.
SERVICE_REASONS = ("no_pass_verdict", "bundle_timeout")
NAMES = ("Star Sines", "", "  Upgrade Probe  ", "Pack {fix} {name}")


def _table() -> dict:
    return json.loads(TABLE.read_text(encoding="utf-8"))


def _script_reasons() -> list[str]:
    """The values of bundle-pack-entry.mjs's SETUP_REASONS (every reason code it can emit)."""
    src = BUNDLE_SCRIPT.read_text(encoding="utf-8")
    m = re.search(r"const SETUP_REASONS = Object\.freeze\(\{(.*?)\}\);", src, re.S)
    assert m, "SETUP_REASONS in bundle-pack-entry.mjs"
    reasons = re.findall(r':\s*"(\w+)"', m.group(1))
    assert len(reasons) >= 9, reasons
    return reasons


def _script_sentences(cases: list[tuple[str, str]]) -> list[str]:
    """What the script's renderer (the module bundle-pack-entry.mjs imports) says for each case."""
    node = shutil.which("node")
    if not node:
        pytest.skip("node not on PATH")
    code = (
        f"const m = await import({json.dumps(COPY_MODULE.as_uri())});"
        "const cases = JSON.parse(process.argv[1]);"
        "process.stdout.write(JSON.stringify(cases.map(([n, r]) => m.setupSentence(n, r))));"
    )
    r = subprocess.run(
        [node, "--input-type=module", "-e", code, json.dumps(cases)], capture_output=True, text=True, timeout=30
    )
    assert r.returncode == 0, r.stderr
    return json.loads(r.stdout)


def test_the_service_and_the_script_render_every_table_entry_the_same() -> None:
    reasons = [*_table()["reasons"], "", "not_a_reason"]
    cases = [(name, reason) for reason in reasons for name in NAMES]
    script = _script_sentences(cases)
    service = [format_install_lint_setup_message(name, reason) for name, reason in cases]
    diffs = [(c, s, v) for c, s, v in zip(cases, script, service) if s != v]
    assert not diffs, f"service and script disagree on setup copy (case, script, service): {diffs}"


def _script_templates(cases: list[tuple[str, str]]) -> list[str]:
    """The script module's template choice (setupTemplate) for each (kind, reason)."""
    node = shutil.which("node")
    if not node:
        pytest.skip("node not on PATH")
    code = (
        f"const m = await import({json.dumps(COPY_MODULE.as_uri())});"
        "const cases = JSON.parse(process.argv[1]);"
        "process.stdout.write(JSON.stringify(cases.map(([k, r]) => m.setupTemplate(k, r))));"
    )
    r = subprocess.run(
        [node, "--input-type=module", "-e", code, json.dumps(cases)], capture_output=True, text=True, timeout=30
    )
    assert r.returncode == 0, r.stderr
    return json.loads(r.stdout)


def test_the_service_and_the_script_pick_the_same_template_for_every_reason() -> None:
    """#186 lint_timeout: `overrides` is read the same way on both sides (install and upgrade)."""
    reasons = [*_table()["reasons"], "", "not_a_reason"]
    cases = [(kind, reason) for reason in reasons for kind in ("install", "upgrade")]
    script = _script_templates(cases)
    service = [pil.setup_template(kind, reason) for kind, reason in cases]
    diffs = [(c, s, v) for c, s, v in zip(cases, script, service) if s != v]
    assert not diffs, f"service and script pick different templates (case, script, service): {diffs}"
    assert "in time" in pil.setup_template("upgrade", "lint_timeout")


def test_the_backstop_and_the_scripts_timeout_say_the_same_thing() -> None:
    """#186: bundle_timeout (the service's backstop) and lint_timeout (the script's timer) are two codes
    and one sentence, fresh install and upgrade, on each side that renders it: the script renders the
    install sentence (and picks templates the same way); the service renders both."""
    names = [*NAMES, "Upgrade Probe"]
    cases = [(name, reason) for name in names for reason in ("lint_timeout", "bundle_timeout")]
    script = dict(zip(cases, _script_sentences(cases)))
    tpl_cases = [(kind, reason) for kind in ("install", "upgrade") for reason in ("lint_timeout", "bundle_timeout")]
    script_tpl = dict(zip(tpl_cases, _script_templates(tpl_cases)))
    diffs = []
    for name in names:
        if script[(name, "bundle_timeout")] != script[(name, "lint_timeout")]:
            diffs.append(("script install", name, script[(name, "bundle_timeout")], script[(name, "lint_timeout")]))
        a = format_install_lint_setup_message(name, "bundle_timeout")
        b = format_install_lint_setup_message(name, "lint_timeout")
        if a != b:
            diffs.append(("service install", name, a, b))
        for old in (3, "2.1", None, ""):
            a = pil.format_install_lint_setup_upgrade_message(name, old, "bundle_timeout")
            b = pil.format_install_lint_setup_upgrade_message(name, old, "lint_timeout")
            if a != b:
                diffs.append(("service upgrade", name, old, a, b))
    for kind in ("install", "upgrade"):
        if script_tpl[(kind, "bundle_timeout")] != script_tpl[(kind, "lint_timeout")]:
            diffs.append(("script template", kind, script_tpl[(kind, "bundle_timeout")], script_tpl[(kind, "lint_timeout")]))
    assert not diffs, f"bundle_timeout and lint_timeout render differently: {diffs}"
    assert "in time" in format_install_lint_setup_message("Star Sines", "bundle_timeout")


def test_both_sides_read_the_one_table_file() -> None:
    assert SETUP_COPY_PATH == TABLE, SETUP_COPY_PATH
    assert pil.SETUP_COPY == _table(), "the service's table is the file's"
    src = COPY_MODULE.read_text(encoding="utf-8")
    assert re.search(r'SETUP_COPY_FILE = "pack-install-lint-setup-copy\.json"', src), "the script's module reads the same file"
    assert "path.join(here, SETUP_COPY_FILE)" in src
    assert re.search(r'import\("\./pack-install-lint-setup-copy\.mjs"\)', BUNDLE_SCRIPT.read_text(encoding="utf-8"))


def test_neither_side_carries_the_wording_of_its_own() -> None:
    """The sentence's words live only in the table: not in the service, the script or its module."""
    table = _table()
    fragments = [
        *table["fixes"].values(),
        "so it wasn't installed",
        "so it wasn't updated",
        "You're still on",
        "is still installed. Run",
        "The version you had is still installed",
        "in time, so it wasn't",
    ]
    sources = [BUNDLE_SCRIPT, COPY_MODULE, *(ROOT / "service").glob("*.py")]
    hits = [(p.relative_to(ROOT).as_posix(), f) for p in sources for f in fragments if f in p.read_text(encoding="utf-8")]
    assert not hits, f"setup copy outside {TABLE.relative_to(ROOT)}: {hits}"


def test_every_reason_the_script_or_service_emits_is_in_the_table() -> None:
    """No reason silently falls to the default; TSE's lint_timeout gets its own entry the same way."""
    table = _table()
    missing = [r for r in (*_script_reasons(), *SERVICE_REASONS) if r not in table["reasons"]]
    assert not missing, f"reason codes without a table entry: {missing}"
    assert set(table["reasons"].values()) | {table["default"]} <= set(table["fixes"]), table


PREPARE_REASONS = ("lint_prebuilt_missing", "lint_prebuilt_stale", "lint_prebuilt_unloadable")
TIMEOUT_REASONS = ("lint_timeout", "bundle_timeout")


def test_the_table_says_what_ux_pro_decided() -> None:
    """A missing, stale or unloadable built lint: `pnpm run prepare`. The script's own timeout: "in time",
    try again, and an upgrade that says only which version is still there. Everything else: `pnpm install`.
    Upgrade: "You're still on version <old>." / "The version you had is still installed." (every fix)."""
    table = _table()
    for reason in PREPARE_REASONS:
        assert table["fixes"][table["reasons"][reason]] == "Run `pnpm run prepare` in `web/` and try again.", reason
    assert table["still"] == "You're still on version {old}."
    assert table["still_unknown"] == "The version you had is still installed."
    assert table["upgrade"] == "Couldn't safety-check the new version of {name}, so it wasn't updated. {still} {fix}"
    for reason in TIMEOUT_REASONS:
        assert table["fixes"][table["reasons"][reason]] == "Try again, and if it keeps happening, the pack may be broken.", reason
    assert table["overrides"] == {
        "in_time": {
            "install": "Couldn't safety-check {name} in time, so it wasn't installed. {fix}",
            "upgrade": "Couldn't safety-check the new version of {name} in time, so it wasn't updated. {still}",
        }
    }
    assert table["reason_overrides"] == {"lint_timeout": "in_time", "bundle_timeout": "in_time"}
    assert "lint_timeout" in _script_reasons()
    for reason in (*_script_reasons(), *SERVICE_REASONS):
        if reason in PREPARE_REASONS or reason in TIMEOUT_REASONS:
            continue
        assert table["fixes"][table["reasons"][reason]] == "Run `pnpm install` in `web/` and try again.", reason
    assert table["fixes"][table["default"]] == "Run `pnpm install` in `web/` and try again."
