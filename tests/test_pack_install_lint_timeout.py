"""#186 lint_timeout (service side): the script's own timer refuses a lint that runs too long, the
service surfaces its reason code and UX Pro's sentence (fresh install and upgrade), and the service's
own timeout and process-group kill stay as the backstop.

bundle-pack-entry.mjs runs the lint in a worker_thread and bounds the lint-mode run with
LINT_TIMEOUT_MS (15 s), inside the service's PACK_BUNDLE_TIMEOUT_S (20 s). These rows run the real
service install path against a temp copy of web/scripts whose built lint busy-loops (with a
`setInterval` child of its own); ZOTO_PACK_INSTALL_LINT_TIMEOUT_MS shortens the script's timer (it can
only shorten it). The script-level rows (orphans, group-leader guard) are
web/src/plugins/pack-install-lint-timeout.test.ts.
"""
from __future__ import annotations

import json
import logging
import os
import re
import signal
from pathlib import Path

import pytest

from service import paths
from service import plugin_local
from service import plugins
from service.pack_install_lint import (
    EXIT_LINT_SETUP,
    REASON_INSTALL_CHECK_UNAVAILABLE,
    PackInstallLintSetupError,
    format_install_lint_setup_message,
    format_install_lint_setup_upgrade_message,
)
from tests.pack_install_lint_tree_util import ROOT, script_tree
from tests.test_pack_install_lint_fail_closed import PULSE, _gone, _needs_node_tree, _probe, _pulse_doc, _repo
from tests.test_pack_install_lint_prebuilt import _real_stamp, _setup_reasons, _spy_codes

SCRIPT = ROOT / "web" / "scripts" / "bundle-pack-entry.mjs"
INNER_MS = 1500
TRY_AGAIN = "Try again, and if it keeps happening, the pack may be broken."


def _spinning_tree(tmp_path: Path, pids: Path) -> Path:
    """A scripts copy whose built lint (real stamp) starts a setInterval child, then busy-loops."""
    spin = (
        "import { spawn } from 'node:child_process';\n"
        "import { appendFileSync } from 'node:fs';\n"
        "export function runPackInstallLint() {\n"
        "  const c = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });\n"
        f"  appendFileSync({json.dumps(str(pids))}, `${{process.pid}} ${{c.pid}}\\n`);\n"
        "  for (;;) {}\n"
        "}\n"
        f"export const PACK_INSTALL_LINT_BUILD = {_real_stamp()};\n"
    )
    return script_tree(tmp_path, built=spin, name="tree-spinning-lint")


def _all_gone(pids: Path) -> None:
    assert pids.is_file(), "the lint really ran"
    got = [int(p) for p in pids.read_text().split()]
    assert len(got) == 2, got
    for pid in got:
        assert _gone(pid), f"pid {pid} left running after lint_timeout"


def test_the_inner_timer_is_shorter_than_the_service_timeout() -> None:
    """15 s in the script, 20 s in the service (the backstop, unchanged): the script's refusal comes first."""
    script = SCRIPT.read_text(encoding="utf-8")
    m = re.search(r"^const LINT_TIMEOUT_MS = ([\d_]+);$", script, re.M)
    assert m, "LINT_TIMEOUT_MS in bundle-pack-entry.mjs"
    inner_ms = int(m.group(1).replace("_", ""))
    assert plugins.PACK_BUNDLE_TIMEOUT_S == 20
    assert inner_ms == 15_000
    assert inner_ms + 5_000 <= plugins.PACK_BUNDLE_TIMEOUT_S * 1000, "5 s left for start-up, the group kill and the exit"
    assert 'timeout: "lint_timeout"' in script, "SETUP_REASONS.timeout"


def test_the_timeout_sentences_are_ux_pros() -> None:
    assert format_install_lint_setup_message("Star Sines", "lint_timeout") == (
        f"Couldn't safety-check Star Sines in time, so it wasn't installed. {TRY_AGAIN}"
    )
    assert format_install_lint_setup_upgrade_message("Star Sines", 3, "lint_timeout") == (
        "Couldn't safety-check the new version of Star Sines in time, so it wasn't updated. You're still on version 3."
    )
    assert format_install_lint_setup_upgrade_message("Star Sines", None, "lint_timeout") == (
        "Couldn't safety-check the new version of Star Sines in time, so it wasn't updated. The version you had is still installed."
    )
    assert str(PackInstallLintSetupError("Star Sines", "lint_timeout")) == (
        f"Couldn't safety-check Star Sines in time, so it wasn't installed. {TRY_AGAIN}"
    )


def test_a_lint_that_runs_too_long_is_refused_with_lint_timeout_and_leaves_no_process(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    """The script's timer (not the service's) ends it: exit 3, reason lint_timeout, UX Pro's install
    sentence, and the lint's own child went with the script's process group."""
    _needs_node_tree()
    pids = tmp_path / "pids"
    monkeypatch.setattr(plugins, "_PACK_BUNDLE_SCRIPT", _spinning_tree(tmp_path, pids))
    monkeypatch.setenv("ZOTO_PACK_INSTALL_LINT_TIMEOUT_MS", str(INNER_MS))
    codes = _spy_codes(monkeypatch)
    caplog.set_level(logging.WARNING, logger="service.plugins")
    plugins.reset_bundles()
    with pytest.raises(PackInstallLintSetupError) as e:
        plugins.compile_typescript(_pulse_doc(), PULSE, update_cache=False, install_lint=True)
    assert not isinstance(e.value.__cause__, plugins._PackScriptTimeout), (
        f"the service's {plugins.PACK_BUNDLE_TIMEOUT_S} s backstop fired, not the script's lint_timeout"
    )
    assert codes == [EXIT_LINT_SETUP], codes
    assert e.value.reason == "lint_timeout"
    assert _setup_reasons(caplog) == ["lint_timeout"], caplog.text
    assert str(e.value) == f"Couldn't safety-check Pulse TS in time, so it wasn't installed. {TRY_AGAIN}"
    _all_gone(pids)


def test_an_upgrade_whose_lint_runs_too_long_keeps_the_old_version(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    _isolate_plugin_local: Path,
) -> None:
    """v3 installed, v4's lint times out: not updated, "You're still on version 3." and no fix sentence."""
    _needs_node_tree()
    _repo(tmp_path, monkeypatch)
    plugins.reset_bundles()
    first = plugin_local.install_local_zip(_probe(tmp_path, 3), overwrite=True)
    assert first.get("wrote") is True, first
    runtime = paths.plugin_local_runtime_dir(create=True) / "upgrade-probe"
    pids = tmp_path / "pids"
    monkeypatch.setattr(plugins, "_PACK_BUNDLE_SCRIPT", _spinning_tree(tmp_path, pids))
    monkeypatch.setenv("ZOTO_PACK_INSTALL_LINT_TIMEOUT_MS", str(INNER_MS))
    codes = _spy_codes(monkeypatch)
    plugins.reset_bundles()
    out = plugin_local.install_local_zip(_probe(tmp_path, 4), overwrite=True)
    assert codes == [EXIT_LINT_SETUP], codes
    assert out.get("ok") is False and out.get("error") == REASON_INSTALL_CHECK_UNAVAILABLE, out
    assert out.get("message") == (
        "Couldn't safety-check the new version of Upgrade Probe in time, so it wasn't updated. You're still on version 3."
    ), out
    assert "lint_timeout" not in str(out)
    assert "version: 3" in (runtime / "plugin.yml").read_text(encoding="utf-8"), "v3 is still installed"
    _all_gone(pids)


def test_a_lint_stuck_in_a_native_call_is_still_refused_with_lint_timeout(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    """The lint blocks in open() of a FIFO nobody writes: the worker can't be stopped and Node can't
    exit 3 past it, so the script kills itself after writing the lint_timeout line. The service reads
    that line (not the exit status) and still gives lint_timeout's sentence, before its own timeout."""
    _needs_node_tree()
    fifo = tmp_path / "never-written"
    os.mkfifo(fifo)
    pids = tmp_path / "pids"
    stuck = (
        "import { appendFileSync, readFileSync } from 'node:fs';\n"
        "export function runPackInstallLint() {\n"
        f"  appendFileSync({json.dumps(str(pids))}, `${{process.pid}}\\n`);\n"
        f"  readFileSync({json.dumps(str(fifo))});\n"
        "  return { kind: 'pass' };\n"
        "}\n"
        f"export const PACK_INSTALL_LINT_BUILD = {_real_stamp()};\n"
    )
    monkeypatch.setattr(plugins, "_PACK_BUNDLE_SCRIPT", script_tree(tmp_path, built=stuck, name="tree-native-stuck"))
    monkeypatch.setenv("ZOTO_PACK_INSTALL_LINT_TIMEOUT_MS", str(INNER_MS))
    codes = _spy_codes(monkeypatch)
    caplog.set_level(logging.WARNING, logger="service.plugins")
    plugins.reset_bundles()
    with pytest.raises(PackInstallLintSetupError) as e:
        plugins.compile_typescript(_pulse_doc(), PULSE, update_cache=False, install_lint=True)
    assert not isinstance(e.value.__cause__, plugins._PackScriptTimeout), (
        f"the service's {plugins.PACK_BUNDLE_TIMEOUT_S} s backstop fired, not the script's lint_timeout"
    )
    assert codes and codes[0] in (EXIT_LINT_SETUP, -signal.SIGKILL), codes
    assert e.value.reason == "lint_timeout"
    assert _setup_reasons(caplog) == ["lint_timeout"], caplog.text
    assert str(e.value) == f"Couldn't safety-check Pulse TS in time, so it wasn't installed. {TRY_AGAIN}"
    got = [int(p) for p in pids.read_text().split()]
    assert got and all(_gone(p) for p in got), got
