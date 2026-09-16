from __future__ import annotations

import importlib.util
import time
from pathlib import Path

import pytest

from service import hooks
from service import plugins


ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "plugins" / "src"


@pytest.fixture(autouse=True)
def _clean_hooks() -> None:
    hooks.reset()
    yield
    hooks.reset()


def _dir_plugin(tmp_path: Path, body: str, *, name: str = "pulse") -> Path:
    home = tmp_path / name
    home.mkdir()
    yml = home / "plugin.yml"
    yml.write_text(
        "\n".join(
            [
                f"id: {name}",
                "name: Pulse",
                "version: 1",
                "engine: graph",
                "base: topology",
                body,
            ]
        ).strip()
        + "\n",
        encoding="utf-8",
    )
    return yml


def test_service_meta_pulse() -> None:
    src = SRC / "pulse-ts" / "plugin.yml"
    extra = plugins.service_meta(plugins.load_file(src), src)
    assert extra["service"] == "backend/service.py"


def test_flat_yaml_does_not_auto_attach_sibling_service(tmp_path: Path) -> None:
    (tmp_path / "service.py").write_text("def setup(host):\n    pass\n", encoding="utf-8")
    yml = tmp_path / "topology.yml"
    yml.write_text((SRC / "topology" / "plugin.yml").read_text(encoding="utf-8"), encoding="utf-8")
    assert plugins.service_meta(plugins.load_file(yml), yml) == {}


def test_service_path_confined(tmp_path: Path) -> None:
    home = tmp_path / "plug"
    home.mkdir()
    try:
        hooks.service_path(home, {"service": "../evil.py"})
        raise AssertionError("escape")
    except ValueError:
        pass
    try:
        hooks.service_path(home, {"service": "/etc/passwd"})
        raise AssertionError("absolute")
    except ValueError:
        pass


def test_missing_declared_service(tmp_path: Path) -> None:
    yml = _dir_plugin(tmp_path, "service: missing.py")
    try:
        plugins.service_meta(plugins.load_file(yml), yml)
        raise AssertionError("missing")
    except ValueError as e:
        assert "missing service module" in str(e)


def test_scan_records_service_error(tmp_path: Path) -> None:
    _dir_plugin(tmp_path, "service: missing.py")
    result = plugins.scan(tmp_path)
    assert result["errors"]
    assert "missing service module" in result["errors"][0]["error"]


def test_load_reload_snapshot(tmp_path: Path) -> None:
    yml = _dir_plugin(tmp_path, "")
    py = yml.parent / "service.py"
    py.write_text(
        "n = 0\n"
        "def setup(host):\n"
        "    host.log('up')\n"
        "def teardown(host):\n"
        "    host.log('down')\n"
        "def on_snapshot(host, msg):\n"
        "    global n\n"
        "    n += 1\n"
        "    msg.setdefault('plugin_state', {})[host.plugin_id] = n\n",
        encoding="utf-8",
    )
    spec = {**plugins.load_file(yml), "file": str(yml), **plugins.service_meta(plugins.load_file(yml), yml)}
    hooks.sync([spec])
    assert "pulse" in hooks.loaded()
    msg = hooks.on_snapshot({})
    assert msg["plugin_state"]["pulse"] == 1
    py.write_text(
        "def on_snapshot(host, msg):\n"
        "    msg['reloaded'] = True\n",
        encoding="utf-8",
    )
    # stamp compares mtime floats; a same-second rewrite can look unchanged
    time.sleep(0.02)
    py.touch()
    hooks.sync([spec])
    msg = hooks.on_snapshot({})
    assert msg.get("reloaded") is True
    hooks.sync([])
    assert hooks.loaded() == {}


def test_package_stamp_and_bind(tmp_path: Path) -> None:
    yml = _dir_plugin(tmp_path, "", name="pkg")
    pkg = yml.parent / "service"
    pkg.mkdir()
    (pkg / "__init__.py").write_text("def setup(host):\n    host.ok = True\n", encoding="utf-8")
    spec = {**plugins.load_file(yml), "file": str(yml), **plugins.service_meta(plugins.load_file(yml), yml)}
    seen: list[str] = []
    hooks.bind(lambda pid: (seen.append(pid), hooks.Host(pid, app="app"))[1])
    hooks.sync([spec])
    assert hooks.loaded()["pkg"]["host"].ok is True
    hooks.sync([spec])  # unchanged mtime refreshes host via factory
    assert seen == ["pkg", "pkg"]
    assert hooks.stamp(1.0, pkg / "__init__.py") >= 1.0


def test_hook_exceptions_are_caught(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    yml = _dir_plugin(tmp_path, "", name="boom")
    (yml.parent / "service.py").write_text(
        "def setup(host):\n"
        "    raise RuntimeError('setup')\n"
        "def teardown(host):\n"
        "    raise RuntimeError('teardown')\n"
        "def on_snapshot(host, msg):\n"
        "    raise RuntimeError('tick')\n",
        encoding="utf-8",
    )
    spec = {**plugins.load_file(yml), "file": str(yml), **plugins.service_meta(plugins.load_file(yml), yml)}
    hooks.sync([spec])
    assert hooks.on_snapshot({"ok": True})["ok"] is True
    hooks.unload_all()
    err = capsys.readouterr().err
    assert "setup" in err
    assert "tick" in err
    assert "teardown" in err


def test_import_failure_and_skip_incomplete_spec(tmp_path: Path) -> None:
    yml = _dir_plugin(tmp_path, "", name="bad")
    (yml.parent / "service.py").write_text("raise RuntimeError('nope')\n", encoding="utf-8")
    spec = {**plugins.load_file(yml), "file": str(yml), **plugins.service_meta(plugins.load_file(yml), yml)}
    hooks.sync([spec])
    assert hooks.loaded() == {}
    hooks.sync([{"id": "", "file": str(yml)}])
    hooks.sync([{"id": "x"}])
    hooks.sync([{"id": "escape", "file": str(yml), "service": "../evil.py"}])
    assert hooks.loaded() == {}


def test_load_without_spec(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    yml = _dir_plugin(tmp_path, "", name="nospec")
    py = yml.parent / "service.py"
    py.write_text("x = 1\n", encoding="utf-8")
    spec = {**plugins.load_file(yml), "file": str(yml), **plugins.service_meta(plugins.load_file(yml), yml)}
    monkeypatch.setattr(importlib.util, "spec_from_file_location", lambda *a, **k: None)
    hooks.sync([spec])
    assert hooks.loaded() == {}


def test_stat_error_drops(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    yml = _dir_plugin(tmp_path, "", name="gone")
    py = yml.parent / "service.py"
    py.write_text("def setup(host):\n    pass\n", encoding="utf-8")
    spec = {**plugins.load_file(yml), "file": str(yml), **plugins.service_meta(plugins.load_file(yml), yml)}
    hooks.sync([spec])
    assert "gone" in hooks.loaded()
    hits = {"n": 0}
    real_stat = Path.stat

    def boom(self, *a, **k):
        if self == py:
            hits["n"] += 1
            if hits["n"] > 2:
                raise OSError("gone")
        return real_stat(self, *a, **k)

    monkeypatch.setattr(Path, "stat", boom)
    hooks.sync([spec])
    assert "gone" not in hooks.loaded()


def test_missing_file_unloads(tmp_path: Path) -> None:
    yml = _dir_plugin(tmp_path, "", name="drop")
    py = yml.parent / "service.py"
    py.write_text("def setup(host):\n    pass\n", encoding="utf-8")
    spec = {**plugins.load_file(yml), "file": str(yml), **plugins.service_meta(plugins.load_file(yml), yml)}
    hooks.sync([spec])
    py.unlink()
    hooks.sync([spec])
    assert hooks.loaded() == {}


def test_directory_plugin_without_python(tmp_path: Path) -> None:
    yml = _dir_plugin(tmp_path, "", name="empty")
    assert plugins.service_meta(plugins.load_file(yml), yml) == {}


def test_is_file_oserror_skips(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    yml = _dir_plugin(tmp_path, "", name="ioerr")
    py = yml.parent / "service.py"
    py.write_text("def setup(host):\n    pass\n", encoding="utf-8")
    spec = {**plugins.load_file(yml), "file": str(yml), **plugins.service_meta(plugins.load_file(yml), yml)}
    hooks.sync([spec])
    real = Path.is_file

    def boom(self):  # noqa: ANN001
        if self == py:
            raise OSError("io")
        return real(self)

    monkeypatch.setattr(Path, "is_file", boom)
    hooks.sync([spec])
    assert "ioerr" not in hooks.loaded()


def test_stamp_skips_unreadable(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    pkg = tmp_path / "service"
    pkg.mkdir()
    init = pkg / "__init__.py"
    init.write_text("x = 1\n", encoding="utf-8")
    other = pkg / "more.py"
    other.write_text("y = 1\n", encoding="utf-8")
    real = Path.stat

    def boom(self, *a, **k):  # noqa: ANN001
        if self == other:
            raise OSError("x")
        return real(self, *a, **k)

    monkeypatch.setattr(Path, "stat", boom)
    assert hooks.stamp(1.0, init) >= 1.0


def test_host_log(capsys: pytest.CaptureFixture[str]) -> None:
    hooks.Host("x").log("hi")
    assert "[plugin:x] hi" in capsys.readouterr().err


def test_call_unknown_hook_name(tmp_path: Path) -> None:
    yml = _dir_plugin(tmp_path, "", name="extra")
    (yml.parent / "service.py").write_text(
        "def ping(host, n):\n"
        "    host.n = n\n"
        "def setup(host):\n"
        "    pass\n"
        "def teardown(host):\n"
        "    pass\n",
        encoding="utf-8",
    )
    spec = {**plugins.load_file(yml), "file": str(yml), **plugins.service_meta(plugins.load_file(yml), yml)}
    hooks.sync([spec])
    hooks._call("ping", 7)
    assert hooks.loaded()["extra"]["host"].n == 7
    hooks._call("setup")
    hooks._call("teardown")
    hooks._call("missing")
    hooks._drop("nope")


def test_sync_allow_skips_python(tmp_path: Path) -> None:
    yml = _dir_plugin(tmp_path, "", name="gated")
    (yml.parent / "service.py").write_text("def setup(host):\n    host.ok = True\n", encoding="utf-8")
    spec = {**plugins.load_file(yml), "file": str(yml), **plugins.service_meta(plugins.load_file(yml), yml)}
    hooks.sync([spec], allow=lambda _: False)
    assert hooks.loaded() == {}
    hooks.sync([spec], allow=lambda _: True)
    assert "gated" in hooks.loaded()

