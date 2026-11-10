"""Isolate HOME and the user-local plugin drop zone so the suite never reads or writes ~/.zoto-viz.

HOME (and the XDG base dirs) must point at a scratch dir *before* any ``service`` import:
``service.paths._HOME`` and module-level files such as ``plugins.CONSENT_FILE`` are bound at import.
"""
from __future__ import annotations

import atexit
import os
import shutil
import tempfile
from pathlib import Path

TEST_HOME = Path(tempfile.mkdtemp(prefix="zoto-viz-test-home-")).resolve()
atexit.register(shutil.rmtree, TEST_HOME, ignore_errors=True)
os.environ["ZOTO_VIZ_TEST_HOME"] = str(TEST_HOME)
os.environ["HOME"] = str(TEST_HOME)
if os.name == "nt":
    os.environ["USERPROFILE"] = str(TEST_HOME)
for _var, _rel in (
    ("XDG_CONFIG_HOME", ".config"),
    ("XDG_DATA_HOME", ".local/share"),
    ("XDG_CACHE_HOME", ".cache"),
    ("XDG_STATE_HOME", ".local/state"),
):
    os.environ[_var] = str(TEST_HOME / _rel)

import pytest  # noqa: E402

from service import paths  # noqa: E402
from service import plugin_local  # noqa: E402


@pytest.fixture(autouse=True)
def _isolate_plugin_local(tmp_path_factory: pytest.TempPathFactory, monkeypatch: pytest.MonkeyPatch) -> Path:
    root = tmp_path_factory.mktemp("plugin-local")
    local = root / "local"
    runtime = local / ".runtime"

    def fake_local(*, create: bool = False) -> Path:
        if create:
            local.mkdir(parents=True, exist_ok=True)
        return local

    def fake_runtime(*, create: bool = False) -> Path:
        if create:
            runtime.mkdir(parents=True, exist_ok=True)
        return runtime

    monkeypatch.setattr(paths, "plugin_local_dir", fake_local)
    monkeypatch.setattr(paths, "plugin_local_runtime_dir", fake_runtime)
    plugin_local.reset_watch_for_tests()
    from service import live, plugins

    plugins.reset_scan_memo()
    live.reset_for_tests()
    live.set_autoconsent(False)
    return local
