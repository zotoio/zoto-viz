"""#200: a fresh install whose safety check can't run (InstallCheckUnavailableError) is one blocked pack,
never a 500 for the whole catalog, and never an installed or stored record.

The check can't run here when reading the staged pack fails (an OSError from verify_pack_bundle_home);
every missing-tool cause is already a PackInstallLintSetupError with #185's fix sentence. The user sees
the shared copy table's ``install_unchecked``: "Couldn't safety-check <Name>, so it wasn't installed."
"""
from __future__ import annotations

import io
import json
import shutil
import zipfile
from pathlib import Path
from typing import Any

import pytest

from service import paths
from service import plugins
from service.pack_install_copy import REASON_INSTALL_UNCHECKED

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "plugins/sdk/pack-bundle-fixtures/upgrade-probe"
BAD = "upgrade-probe"
GOOD = "upgrade-probe-ok"
#: The fixture pack's own name (test data).
BAD_NAME = "Upgrade probe v1"
SENTENCE = f"Couldn't safety-check {BAD_NAME}, so it wasn't installed."


@pytest.fixture(autouse=True)
def _fresh_block_caches(_isolate_plugin_local: Path):
    """No remembered zip blocks between rows (the fixture zips are byte-identical across rows)."""
    from service.pack_runtime import _clear_zip_block_cache
    from service.pack_zip_blocks import reset_zip_blocks_for_tests

    reset_zip_blocks_for_tests()
    _clear_zip_block_cache()
    plugins.reset_scan_memo()
    yield
    reset_zip_blocks_for_tests()
    _clear_zip_block_cache()


def _repo(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    repo = tmp_path / "checkout"
    (repo / "plugins" / "src").mkdir(parents=True)
    (repo / "plugins" / ".runtime").mkdir(parents=True)
    monkeypatch.setenv("ZOTO_VIZ_REPO_ROOT", str(repo))
    plugins.reset_bundles()


def _pack(tmp_path: Path, pack_id: str) -> bytes:
    src = tmp_path / f"src-{pack_id}"
    shutil.copytree(FIXTURE, src)
    yml = src / "plugin.yml"
    text = yml.read_text(encoding="utf-8")
    if pack_id != BAD:
        text = text.replace(f"id: {BAD}", f"id: {pack_id}").replace(f"name: {BAD_NAME}", "name: Good probe")
    yml.write_text(text, encoding="utf-8")
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        for path in src.rglob("*"):
            if path.is_file():
                zf.write(path, path.relative_to(src).as_posix())
    return buf.getvalue()


def _check_cant_run_for_bad(monkeypatch: pytest.MonkeyPatch) -> None:
    """verify_pack_bundle_home can't read the bad pack's staged tree; the good pack checks normally."""
    real = plugins.verify_pack_bundle_home

    def verify(home: Path, doc: dict[str, Any], sha256: str | None = None) -> None:
        if doc.get("id") == BAD:
            raise OSError("staged entry unreadable")
        real(home, doc, sha256=sha256)

    monkeypatch.setattr(plugins, "verify_pack_bundle_home", verify)


def _catalog() -> tuple[int, dict[str, Any]]:
    """GET /api/plugins, through the real handler."""
    plugins.reset_scan_memo()
    resp = plugins.api_list(None)
    return resp.status, json.loads(resp.text)


def test_scan_lists_an_unchecked_fresh_pack_as_blocked_and_the_catalog_still_loads(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """(a) scan(): the one pack is an errors row (fresh-install sentence, stable reasonCode), the other
    pack still lists, and /api/plugins answers 200. On main the scan raises and the handler 500s."""
    _repo(tmp_path, monkeypatch)
    drop = paths.plugin_local_dir(create=True)
    (drop / f"{GOOD}.zip").write_bytes(_pack(tmp_path, GOOD))
    (drop / f"{BAD}.zip").write_bytes(_pack(tmp_path, BAD))
    _check_cant_run_for_bad(monkeypatch)

    status, body = _catalog()
    assert status == 200, body
    assert GOOD in [p.get("id") for p in body.get("plugins") or []], body
    rows = [e for e in body.get("errors") or [] if BAD in str(e.get("zip") or e.get("file") or "")]
    assert rows == [
        {
            "file": str(drop / f"{BAD}.zip"),
            "zip": str(drop / f"{BAD}.zip"),
            "error": "pack_install_check_unavailable",
            "message": SENTENCE,
            "reasonCode": REASON_INSTALL_UNCHECKED,
        }
    ], rows
    assert REASON_INSTALL_UNCHECKED == "install_unchecked"
    assert BAD not in [p.get("id") for p in body.get("plugins") or []]
    assert not (paths.plugin_local_runtime_dir(create=True) / BAD).exists(), "nothing installed"


def _no_block_record(zip_bytes: bytes, tmp_path: Path) -> None:
    from service import plugin_zip as pz
    from service.pack_install_blocked_store import blocked_row_for_sha, pack_info_blocked_line
    from service.pack_zip_blocks import zip_block_for_sha

    probe = tmp_path / "sha-probe.zip"
    probe.write_bytes(zip_bytes)
    sha = pz.plugin_sha256(probe)
    assert zip_block_for_sha(sha) is None, "no remembered zip block"
    assert blocked_row_for_sha(sha) is None, "no stored blocked row"
    assert pack_info_blocked_line(BAD) is None, "no stored blocked line for the pack"


_UNCHECKED = {"ok": False, "error": "pack_install_check_unavailable", "message": SENTENCE, "reasonCode": "install_unchecked"}


def test_install_local_zip_whose_check_cant_run_answers_the_sentence_and_installs_nothing(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """(b) install (POST /api/plugins/publish): ok false with the fresh-install sentence and codes; no
    runtime dir, no drop-zone zip, no block record; the next catalog answers 200. On (a) alone it raises."""
    from service import plugin_local

    _repo(tmp_path, monkeypatch)
    _check_cant_run_for_bad(monkeypatch)
    raw = _pack(tmp_path, BAD)

    info = plugin_local.install_local_zip(raw, overwrite=True, activate=True)

    assert {k: info.get(k) for k in _UNCHECKED} == _UNCHECKED, info
    assert info.get("id") is None and not info.get("ok"), info
    assert not (paths.plugin_local_runtime_dir(create=True) / BAD).exists(), "nothing installed"
    assert not (paths.plugin_local_dir(create=True) / f"{BAD}.zip").exists(), "no zip kept in the drop zone"
    _no_block_record(raw, tmp_path)
    status, body = _catalog()
    assert status == 200, body
    assert BAD not in [p.get("id") for p in body.get("plugins") or []]
    assert [e for e in body.get("errors") or [] if BAD in json.dumps(e)] == [], body


def test_adopting_a_dropped_zip_whose_check_cant_run_is_the_same_blocked_pack(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """(b) a zip dropped in the folder (drop watcher adopt): the same answer, nothing installed, and the
    catalog lists it as the one blocked pack. On (a) alone the adopt raises."""
    from service import plugin_local

    _repo(tmp_path, monkeypatch)
    _check_cant_run_for_bad(monkeypatch)
    drop = paths.plugin_local_dir(create=True)
    zpath = drop / f"{BAD}.zip"
    zpath.write_bytes(_pack(tmp_path, BAD))

    info = plugin_local.adopt_local_zip_file(zpath, activate=True)

    assert {k: info.get(k) for k in _UNCHECKED} == _UNCHECKED, info
    assert not (paths.plugin_local_runtime_dir(create=True) / BAD).exists(), "nothing installed"
    status, body = _catalog()
    assert status == 200, body
    rows = [e for e in body.get("errors") or [] if BAD in str(e.get("zip") or "")]
    assert [(r.get("message"), r.get("reasonCode")) for r in rows] == [(SENTENCE, "install_unchecked")], body
