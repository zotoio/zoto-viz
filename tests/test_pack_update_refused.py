"""#111: a refused update carries a stable code, and the service branches on it, never on the wording.

REASON_UPDATE_REFUSED ("update_refused") rides as ``reasonCode`` on every refused-update payload: the new
version couldn't be checked (install path and catalog path), or it couldn't start and the old one was put
back (catalog path, service/plugins.py). web/src/plugins/pack-install-surface.ts reads the same code.
"""
from __future__ import annotations

import io
import shutil
import zipfile
from pathlib import Path

import pytest

from service import paths
from service import plugin_local
from service import plugins
from service.pack_install_copy import REASON_UPDATE_REFUSED

PID = "upgrade-probe"
FIXTURE = Path(__file__).resolve().parents[1] / "plugins/sdk/pack-bundle-fixtures" / PID


def _repo(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    repo = tmp_path / "checkout"
    (repo / "plugins" / "src").mkdir(parents=True)
    (repo / "plugins" / ".runtime").mkdir(parents=True)
    monkeypatch.setenv("ZOTO_VIZ_REPO_ROOT", str(repo))


def _zip_tree(src: Path) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        for path in src.rglob("*"):
            if path.is_file():
                zf.write(path, path.relative_to(src).as_posix())
    return buf.getvalue()


def _pack(tmp_path: Path, n: int) -> bytes:
    src = tmp_path / f"v{n}"
    shutil.copytree(FIXTURE, src)
    yml = src / "plugin.yml"
    yml.write_text(yml.read_text(encoding="utf-8").replace("version: 1", f"version: {n}"), encoding="utf-8")
    (src / "frontend" / "sdk" / "marker.ts").write_text(f'export const marker = "upgrade-v{n}";\n', encoding="utf-8")
    return _zip_tree(src)


def _install_v1(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    _repo(tmp_path, monkeypatch)
    plugins.reset_bundles()
    plugin_local.install_local_zip(_pack(tmp_path, 1), overwrite=True)
    assert (paths.plugin_local_runtime_dir(create=True) / PID / "plugin.yml").is_file(), "v1 installed"
    plugins.scan()


def _check_unavailable(*_a: object, **_k: object) -> None:
    raise OSError("node went missing")


def _catalog_errors() -> list[dict[str, str]]:
    """The first scan after the new zip lands: the one that tries the update (later scans list the
    persisted start-failure record, which has codes of its own: pack_install_start_failed / couldnt_start)."""
    plugins.reset_scan_memo()
    return [e for e in plugins.scan()["errors"] if PID in str(e.get("zip") or e.get("file") or "")]


def test_update_refused_payload_carries_the_code(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    _isolate_plugin_local: Path,
) -> None:
    """Install path: the new version couldn't be checked, so the update was refused; the payload says so
    with reasonCode, whatever the message says."""
    _install_v1(tmp_path, monkeypatch)
    monkeypatch.setattr(plugins, "verify_pack_bundle_home", _check_unavailable)
    info = plugin_local.install_local_zip(_pack(tmp_path, 2), overwrite=True)
    assert info.get("ok") is False, info
    assert info.get("reasonCode") == REASON_UPDATE_REFUSED == "update_refused", info
    assert info.get("error") == "pack_install_blocked", info
    assert info.get("upgrade_blocked") == "true", info


def test_catalog_row_for_a_refused_update_carries_the_code(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    _isolate_plugin_local: Path,
) -> None:
    """Catalog path (service/plugins.py): a new version that couldn't be checked, and one that couldn't
    start (the old one put back), are both refused updates, told apart from other failures by the code."""
    _install_v1(tmp_path, monkeypatch)
    drop = paths.plugin_local_dir() / f"{PID}.zip"

    with monkeypatch.context() as m:
        m.setattr(plugins, "verify_pack_bundle_home", _check_unavailable)
        drop.write_bytes(_pack(tmp_path, 2))
        rows = _catalog_errors()
    assert len(rows) == 1, rows
    row = rows[0]
    assert row.get("reasonCode") == REASON_UPDATE_REFUSED, row
    assert row.get("error") == "pack_install_blocked", row

    def fail_start(*_a: object, **_k: object) -> None:
        raise RuntimeError("compile exploded")

    with monkeypatch.context() as m:
        m.setattr("service.plugin_install._start_runtime", fail_start)
        drop.write_bytes(_pack(tmp_path, 3))
        rows = _catalog_errors()
    assert len(rows) == 1, rows
    row = rows[0]
    assert row.get("reasonCode") == REASON_UPDATE_REFUSED, row
    assert row.get("error") == "pack_install_blocked", row
    assert row.get("message"), row
