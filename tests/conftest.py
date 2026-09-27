"""Isolate the user-local plugin drop zone so scan() never reads ~/.zoto-viz."""
from __future__ import annotations

from pathlib import Path

import pytest

from service import paths
from service import plugin_local


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
