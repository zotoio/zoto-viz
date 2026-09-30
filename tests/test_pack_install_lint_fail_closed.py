"""#185: the pack install lint fails closed (service side).

bundle-pack-entry.mjs refuses an install with exit 3 and a ``pack-install-lint-setup-error`` line
when the install lint can't run or gives no verdict. The service maps that to
PackInstallLintSetupError with the user-facing wording, keeps a real lint block's existing
"was blocked" message, and refuses an install-lint bundle that carries no pass verdict.

The install rows run the real bundle-pack-entry.mjs with the repo root pointed at a temp tree that
has no tsx, so the lint runner is really unresolvable.
"""
from __future__ import annotations

import io
import json
import os
import shutil
import subprocess
import zipfile
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
)

ROOT = Path(__file__).resolve().parents[1]
PULSE = ROOT / "plugins" / "src" / "pulse-ts" / "plugin.yml"
SETUP_TAIL = ", so it wasn't installed. Run `pnpm install` in `web/` and try again."
_BLOCK_JSON = json.dumps({"type": "pack-install-lint-block", "message": "frontend/leak.ts:1 sandbox-escape — indexedDB"})


def _stub_bundle(monkeypatch: pytest.MonkeyPatch, code: int, stderr: str, stdout: str = "export {};\n") -> None:
    def run(cmd: list[str], **kwargs: object) -> subprocess.CompletedProcess[str]:
        return subprocess.CompletedProcess(cmd, code, stdout=stdout if code == 0 else "", stderr=stderr)

    monkeypatch.setattr(subprocess, "run", run)


def _pulse_doc() -> dict:
    if not PULSE.is_file():
        pytest.skip("pulse-ts fixture missing")
    return plugins.load_file(PULSE)


def test_setup_message_wording() -> None:
    assert format_install_lint_setup_message("Star Sines") == (
        "Couldn't safety-check Star Sines, so it wasn't installed. Run `pnpm install` in `web/` and try again."
    )
    assert format_install_lint_setup_message("") == f"Couldn't safety-check Plugin{SETUP_TAIL}"


def test_compile_maps_lint_setup_exit_to_setup_error(monkeypatch: pytest.MonkeyPatch) -> None:
    doc = _pulse_doc()
    setup = json.dumps({"type": "pack-install-lint-setup-error", "message": "x", "detail": "tsx not resolvable"})
    _stub_bundle(monkeypatch, EXIT_LINT_SETUP, f"Couldn't safety-check Pulse TS\n{setup}\n")
    plugins.reset_bundles()
    with pytest.raises(PackInstallLintSetupError) as e:
        plugins.compile_typescript(doc, PULSE, update_cache=False, install_lint=True)
    assert str(e.value) == f"Couldn't safety-check Pulse TS{SETUP_TAIL}"
    assert "was blocked" not in str(e.value)


def test_compile_refuses_install_lint_bundle_without_pass_verdict(monkeypatch: pytest.MonkeyPatch) -> None:
    doc = _pulse_doc()
    _stub_bundle(monkeypatch, 0, "")
    plugins.reset_bundles()
    with pytest.raises(PackInstallLintSetupError, match="Couldn't safety-check Pulse TS"):
        plugins.compile_typescript(doc, PULSE, update_cache=False, install_lint=True)


def test_compile_accepts_install_lint_bundle_with_pass_verdict(monkeypatch: pytest.MonkeyPatch) -> None:
    doc = _pulse_doc()
    _stub_bundle(monkeypatch, 0, '{"type":"pack-install-lint-pass"}\n')
    plugins.reset_bundles()
    out = plugins.compile_typescript(doc, PULSE, update_cache=False, install_lint=True)
    assert out["bytes"] > 0


def test_compile_lint_block_keeps_its_message_and_is_not_a_setup_error(monkeypatch: pytest.MonkeyPatch) -> None:
    doc = _pulse_doc()
    _stub_bundle(monkeypatch, 1, f"frontend/leak.ts:1 sandbox-escape — indexedDB\n{_BLOCK_JSON}\n")
    plugins.reset_bundles()
    with pytest.raises(ValueError) as e:
        plugins.compile_typescript(doc, PULSE, update_cache=False, install_lint=True)
    assert not isinstance(e.value, PackInstallLintSetupError)
    text = str(e.value)
    assert text.startswith("Pulse TS was blocked: frontend/leak.ts:1 sandbox-escape")
    assert "Nothing was installed and the current wall is unchanged." in text
    setup = format_install_lint_setup_message("Pulse TS")
    assert setup not in text and text not in setup
    assert "safety-check" not in text and "pnpm install" not in text
    assert "was blocked" not in setup


# --- install path through the real bundle-pack-entry.mjs, tsx really unresolvable --------------


def _repo(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    repo = tmp_path / "checkout"
    (repo / "plugins" / "src").mkdir(parents=True)
    (repo / "plugins" / ".runtime").mkdir(parents=True)
    monkeypatch.setenv("ZOTO_VIZ_REPO_ROOT", str(repo))
    return repo


def _tree_without_tsx(tmp_path: Path) -> Path:
    """Repo root for bundle-pack-entry.mjs: web/package.json, the lint runner, plugins/sdk; no tsx."""
    tree = tmp_path / "tree-no-tsx"
    (tree / "web" / "scripts").mkdir(parents=True)
    (tree / "plugins").mkdir(parents=True)
    shutil.copy2(ROOT / "web" / "package.json", tree / "web" / "package.json")
    shutil.copy2(ROOT / "web" / "scripts" / "pack-install-lint-run.ts", tree / "web" / "scripts" / "pack-install-lint-run.ts")
    os.symlink(ROOT / "plugins" / "sdk", tree / "plugins" / "sdk")
    assert not (tree / "web" / "node_modules").exists()
    return tree


def _zip_tree(src: Path) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        for path in src.rglob("*"):
            if path.is_file():
                zf.write(path, path.relative_to(src).as_posix())
    return buf.getvalue()


def _probe(tmp_path: Path, version: int) -> bytes:
    src = tmp_path / f"probe-v{version}"
    shutil.copytree(ROOT / "plugins/sdk/pack-bundle-fixtures/upgrade-probe", src)
    yml = src / "plugin.yml"
    yml.write_text(yml.read_text(encoding="utf-8").replace("version: 1", f"version: {version}"), encoding="utf-8")
    return _zip_tree(src)


def _needs_node_tree() -> None:
    if not (ROOT / "web" / "node_modules" / "esbuild").exists():
        pytest.skip("web/node_modules not installed")


def test_install_local_zip_refused_when_lint_runner_unresolvable(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    _isolate_plugin_local: Path,
) -> None:
    _needs_node_tree()
    _repo(tmp_path, monkeypatch)
    monkeypatch.setattr(plugins, "REPO", _tree_without_tsx(tmp_path))
    plugins.reset_bundles()
    out = plugin_local.install_local_zip(_probe(tmp_path, 1), overwrite=True)
    assert out.get("ok") is False, out
    assert out.get("error") == REASON_INSTALL_CHECK_UNAVAILABLE, out
    assert out.get("message") == f"Couldn't safety-check Upgrade probe v1{SETUP_TAIL}"
    assert not (paths.plugin_local_runtime_dir(create=True) / "upgrade-probe").exists()


def test_upgrade_refused_when_lint_runner_unresolvable_keeps_v1(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    _isolate_plugin_local: Path,
) -> None:
    _needs_node_tree()
    _repo(tmp_path, monkeypatch)
    plugins.reset_bundles()
    first = plugin_local.install_local_zip(_probe(tmp_path, 1), overwrite=True)
    assert first.get("wrote") is True, first
    runtime = paths.plugin_local_runtime_dir(create=True) / "upgrade-probe"
    assert runtime.is_dir()
    monkeypatch.setattr(plugins, "REPO", _tree_without_tsx(tmp_path))
    plugins.reset_bundles()
    out = plugin_local.install_local_zip(_probe(tmp_path, 2), overwrite=True)
    assert out.get("ok") is False, out
    assert out.get("error") == REASON_INSTALL_CHECK_UNAVAILABLE, out
    assert out.get("message") == f"Couldn't safety-check Upgrade probe v1{SETUP_TAIL}"
    assert "was blocked" not in str(out.get("message"))
    assert "version: 1" in (runtime / "plugin.yml").read_text(encoding="utf-8")
