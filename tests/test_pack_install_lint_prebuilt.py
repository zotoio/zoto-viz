"""#186: the pack install lint runs in-process from the prebuilt plain-JS
web/scripts/pack-install-lint.built.mjs (service side).

No TS runner is needed to install a pack; the lint's verdict is a return value inside
bundle-pack-entry.mjs, which still ends a pass with the service's nonce-bound line. These rows run
the real service install path (install_local_zip / compile_typescript) and the real script, pointed
at a temp copy of web/scripts (tests/pack_install_lint_tree_util.py) when a row needs the built lint
missing, stale or replaced. The vitest side is web/src/plugins/pack-install-lint-prebuilt.test.ts.
"""
from __future__ import annotations

import json
import logging
import re
import shutil
import subprocess
import time
from pathlib import Path

import pytest

from service import paths
from service import plugin_local
from service import plugins
from service.pack_install_lint import EXIT_LINT_SETUP, REASON_INSTALL_CHECK_UNAVAILABLE, PackInstallLintSetupError
from tests.pack_install_lint_tree_util import BUILT_LINT, ROOT, script_tree
from tests.test_pack_install_lint_fail_closed import (
    PULSE,
    SETUP_TAIL_INSTALL,
    SETUP_TAIL_PREPARE,
    _assert_plain_block_text,
    _bad_probe,
    _blocked,
    _gone,
    _needs_node_tree,
    _probe,
    _pulse_doc,
    _repo,
    _shipped_zip,
    _zip_tree,
)

BUILT_PATH = ROOT / "web" / "scripts" / BUILT_LINT
OUTSIDE = "it loads code from outside its own folder."
SANDBOX = "it tries to reach outside its sandbox."


def _real_stamp() -> str:
    """The committed built lint's PACK_INSTALL_LINT_BUILD export (so a replacement passes the stamp check)."""
    m = re.search(r"^export const PACK_INSTALL_LINT_BUILD = (\{.*?\});\s*\Z", BUILT_PATH.read_text(encoding="utf-8"), re.S | re.M)
    assert m, "PACK_INSTALL_LINT_BUILD footer"
    return m.group(1)


def _setup_reasons(caplog: pytest.LogCaptureFixture) -> list[str]:
    """#186: the reason codes the service logged for setup refusals (log only, never user text)."""
    out = []
    for r in caplog.records:
        m = re.match(r"pack install lint setup refusal \((\w+)\)", r.getMessage())
        if m:
            out.append(m.group(1))
    return out


def _spy_codes(monkeypatch: pytest.MonkeyPatch) -> list[int]:
    codes: list[int] = []
    real = plugins._run_pack_script

    def spy(argv: list[str], env: dict[str, str]) -> subprocess.CompletedProcess[str]:
        proc = real(argv, env)
        codes.append(proc.returncode)
        return proc

    monkeypatch.setattr(plugins, "_run_pack_script", spy)
    return codes


def test_zip_installs_with_no_tsx_present_and_a_finding_is_still_blocked(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    _isolate_plugin_local: Path,
) -> None:
    """No tsx anywhere in the scripts copy: a clean pack installs, a pack with a finding is refused
    with the plain lint sentence (exit 1), not the setup sentence."""
    _needs_node_tree()
    _repo(tmp_path, monkeypatch)
    script = script_tree(tmp_path)
    assert not (script.parent.parent / "node_modules" / "tsx").exists()
    monkeypatch.setattr(plugins, "_PACK_BUNDLE_SCRIPT", script)
    codes = _spy_codes(monkeypatch)
    plugins.reset_bundles()
    ok = plugin_local.install_local_zip(_probe(tmp_path, 1), overwrite=True)
    assert ok.get("wrote") is True, ok
    plugins.reset_bundles()
    bad = plugin_local.install_local_zip(_bad_probe(tmp_path, 2, "lint"), overwrite=True)
    assert bad.get("ok") is False, bad
    text = str(bad.get("message"))
    assert "was blocked because " + SANDBOX in text, text
    _assert_plain_block_text(text)
    assert "safety-check" not in text
    assert codes[-1] == 1, codes
    plugins.reset_bundles()
    unbundled = plugin_local.install_local_zip(_shipped_zip(tmp_path, "sandbox-fixture-multi"), overwrite=True)
    assert unbundled.get("wrote") is True, unbundled


@pytest.mark.parametrize(
    ("tree", "reason", "tail"),
    [
        pytest.param({"built": False}, "lint_prebuilt_missing", SETUP_TAIL_PREPARE, id="built-lint-missing"),
        pytest.param({"stale": True}, "lint_prebuilt_stale", SETUP_TAIL_PREPARE, id="built-lint-stale"),
        pytest.param({"esbuild": False}, "esbuild_unresolvable", SETUP_TAIL_INSTALL, id="esbuild-unresolvable"),
    ],
)
def test_zip_install_setup_refusal_names_its_own_cause(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    _isolate_plugin_local: Path,
    tree: dict,
    reason: str,
    tail: str,
) -> None:
    """Built lint deleted / stale (plugins/sdk edited after the build) / esbuild unresolvable: no
    install, the script's refusal code is 3 (what #169's ``bundle_setup_missing`` keys on), the log
    names this cause's own reason, and the user gets that reason's own sentence (``pnpm run prepare``
    for a missing or stale built lint (and an unloadable one), ``pnpm install`` for esbuild)."""
    _needs_node_tree()
    _repo(tmp_path, monkeypatch)
    monkeypatch.setattr(plugins, "_PACK_BUNDLE_SCRIPT", script_tree(tmp_path, **tree))
    codes = _spy_codes(monkeypatch)
    caplog.set_level(logging.WARNING, logger="service.plugins")
    plugins.reset_bundles()
    out = plugin_local.install_local_zip(_probe(tmp_path, 1), overwrite=True)
    assert codes == [EXIT_LINT_SETUP], codes
    assert _setup_reasons(caplog) == [reason], caplog.text
    assert out.get("ok") is False and out.get("error") == REASON_INSTALL_CHECK_UNAVAILABLE, out
    assert out.get("message") == f"Couldn't safety-check Upgrade Probe{tail}", out
    assert reason not in str(out) and not re.search(r"ERR_|Error\b|\bexit \d|\bat .+:\d+|node:|\b3\b", str(out.get("message")))
    assert not (paths.plugin_local_runtime_dir(create=True) / "upgrade-probe").exists()


def test_a_lint_that_hangs_in_process_is_refused_at_the_service_timeout_and_leaves_no_process(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The built lint blocks bundle-pack-entry.mjs's event loop (and has started a child of its own):
    the service's timeout (the one bound now) refuses with the setup sentence, and neither the script
    nor any descendant is left running."""
    _needs_node_tree()
    pids = tmp_path / "pids"
    hang = (
        "import { spawn } from 'node:child_process';\n"
        "import { appendFileSync } from 'node:fs';\n"
        "export function runPackInstallLint() {\n"
        "  const c = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });\n"
        f"  appendFileSync({json.dumps(str(pids))}, `${{process.pid}} ${{c.pid}}\\n`);\n"
        "  for (;;) {}\n"
        "}\n"
        f"export const PACK_INSTALL_LINT_BUILD = {_real_stamp()};\n"
    )
    monkeypatch.setattr(plugins, "_PACK_BUNDLE_SCRIPT", script_tree(tmp_path, built=hang))
    monkeypatch.setattr(plugins, "PACK_BUNDLE_TIMEOUT_S", 4)
    doc = _pulse_doc()
    plugins.reset_bundles()
    t0 = time.monotonic()
    with pytest.raises(PackInstallLintSetupError) as e:
        plugins.compile_typescript(doc, PULSE, update_cache=False, install_lint=True)
    assert time.monotonic() - t0 < 15
    assert str(e.value) == f"Couldn't safety-check Pulse TS{SETUP_TAIL_INSTALL}", "service timeout: pnpm install"
    assert pids.is_file(), "the lint really ran and hung before the service timeout"
    got = [int(p) for p in pids.read_text().split()]
    assert len(got) == 2, got
    for pid in got:
        assert _gone(pid), f"pid {pid} left running after the service timeout"


def _baselined_tree(tmp_path: Path) -> Path:
    """A repo root whose plugins/sdk is a copy with the probe's sandbox-escape finding in the baseline."""
    tree = tmp_path / "baselined"
    (tree / "plugins").mkdir(parents=True)
    shutil.copytree(ROOT / "plugins" / "sdk", tree / "plugins" / "sdk", symlinks=True)
    baseline_path = tree / "plugins" / "sdk" / "pack-lint-baseline.json"
    baseline = json.loads(baseline_path.read_text(encoding="utf-8"))
    baseline["violations"].append(
        {"file": "plugins/src/upgrade-probe/frontend/index.ts", "rule": "sandbox-escape", "target": "indexedDB"}
    )
    baseline_path.write_text(json.dumps(baseline, indent=2), encoding="utf-8")
    return tree


def test_a_baselined_finding_still_blocks_a_zip_install(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    _isolate_plugin_local: Path,
) -> None:
    """The install lint never reads pack-lint-baseline.json: the probe's finding is in the baseline the
    lint would read (the repo root it's given) and the zip is still refused."""
    _needs_node_tree()
    _repo(tmp_path, monkeypatch)
    tree = _baselined_tree(tmp_path)
    monkeypatch.setattr(plugins, "REPO", tree)
    plugins.reset_bundles()
    out = plugin_local.install_local_zip(_bad_probe(tmp_path, 1, "lint"), overwrite=True)
    assert out.get("ok") is False, out
    assert out.get("message") == _blocked("Upgrade Probe", SANDBOX), out
    assert not (paths.plugin_local_runtime_dir(create=True) / "upgrade-probe").exists()


@pytest.mark.parametrize(
    "spec",
    [
        pytest.param("https://evil.example/x.js", id="remote-url"),
        pytest.param("left-pad", id="bare-module"),
        pytest.param("../../../../web/src/plugins/host.ts", id="relative-outside"),
    ],
)
def test_bundle_false_zip_whose_js_imports_outside_the_pack_is_blocked(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    _isolate_plugin_local: Path,
    spec: str,
) -> None:
    """esbuild's import-boundary check, in-process, for a pack esbuild never bundles."""
    _needs_node_tree()
    _repo(tmp_path, monkeypatch)
    src = tmp_path / "src-sfm"
    shutil.copytree(ROOT / "plugins" / "src" / "sandbox-fixture-multi", src)
    assert "bundle: false" in (src / "plugin.yml").read_text(encoding="utf-8")
    with (src / "frontend" / "helper.js").open("a", encoding="utf-8") as fh:
        fh.write(f"\nimport {json.dumps(spec)};\n")
    plugins.reset_bundles()
    out = plugin_local.install_local_zip(_zip_tree(src), overwrite=True)
    assert out.get("ok") is False, out
    text = str(out.get("message"))
    assert text == _blocked("Sandbox Fixture Multi", OUTSIDE), out
    _assert_plain_block_text(text)
    assert spec not in text and "helper" not in text
    assert not (paths.plugin_local_runtime_dir(create=True) / "sandbox-fixture-multi").exists()


def test_service_timeout_is_the_only_lint_bound() -> None:
    """#185's 15 s runner timeout and --lint-timeout-ms went with the runner; the service's 20 s is it."""
    script = (ROOT / "web" / "scripts" / "bundle-pack-entry.mjs").read_text(encoding="utf-8")
    assert "lint-timeout" not in script and "setTimeout" not in script
    assert not (ROOT / "web" / "scripts" / "pack-install-lint-gate.mjs").exists()
    assert not (ROOT / "web" / "scripts" / "pack-install-lint-run.ts").exists()
    assert plugins.PACK_BUNDLE_TIMEOUT_S == 20
