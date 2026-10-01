"""#240: a pack block carries a stable code, and every service caller branches on it, never on the wording.

Every pack install block reads "<Name> was blocked because …" today (#185, service/pack_block_copy.py),
and the callers used to decide "this was a block" by matching those words. Like #111's
REASON_UPDATE_REFUSED, the block now carries REASON_PACK_BLOCKED ("pack_blocked") as ``reason_code``
on the error and ``reasonCode`` on the payload / row, so UX Pro can reword the copy without a caller
treating a block as a plain failure.

The primary red/green pin for #240: the block copy is reworded so it no longer says "was blocked" and
each service caller must still answer it as a block (error "pack_boundary", the code, the words as
they are). web/src/plugins/pack-refusal-reason-code-240.test.ts is the plain guard for the web side.
"""
from __future__ import annotations

import io
import shutil
import zipfile
from pathlib import Path
from typing import Any

import pytest

from service import pack_block_copy
from service import pack_install_copy
from service import paths
from service import plugin_local
from service import plugins
from service.pack_block_copy import PackBlockedError

PID = "upgrade-probe"
NAME = "Upgrade probe v1"  # the fixture's own name (plugins/sdk/pack-bundle-fixtures/upgrade-probe)
FIXTURE = Path(__file__).resolve().parents[1] / "plugins/sdk/pack-bundle-fixtures" / PID
SENTENCE = "it tries to reach outside its sandbox."
#: The code as the web reads it (web/src/plugins/pack-install-surface.ts PACK_BLOCKED).
PACK_BLOCKED = "pack_blocked"

# A rewording UX Pro could choose: same shape, without the words "was blocked".
REWORDED_INSTALL = "{name} got stopped because {sentence} Nothing was installed, and your wall is unchanged."
REWORDED_UPGRADE = "{name} got stopped because {sentence} Nothing was updated, so version {old} is still installed."
REWORDED_UPGRADE_OLD_UNKNOWN = (
    "{name} got stopped because {sentence} Nothing was updated, so the version you had is still installed."
)


@pytest.fixture(autouse=True)
def _fresh_block_caches(_isolate_plugin_local: Path):
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


def _zip_tree(src: Path) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        for path in src.rglob("*"):
            if path.is_file():
                zf.write(path, path.relative_to(src).as_posix())
    return buf.getvalue()


def _pack(tmp_path: Path, n: int) -> bytes:
    src = tmp_path / f"v{n}"
    if src.is_dir():
        return _zip_tree(src)
    shutil.copytree(FIXTURE, src)
    yml = src / "plugin.yml"
    yml.write_text(yml.read_text(encoding="utf-8").replace("version: 1", f"version: {n}"), encoding="utf-8")
    (src / "frontend" / "sdk" / "marker.ts").write_text(f'export const marker = "upgrade-v{n}";\n', encoding="utf-8")
    return _zip_tree(src)


def _blocked(*_a: object, **_k: object) -> None:
    raise PackBlockedError(NAME, SENTENCE)


def _catalog_rows() -> list[dict[str, str]]:
    plugins.reset_scan_memo()
    return [e for e in plugins.scan()["errors"] if PID in str(e.get("zip") or e.get("file") or "")]


def _check(where: str, got: dict[str, Any], want_message: str, bad: list[str]) -> None:
    """A block, however it's worded: error "pack_boundary", the code, and the service's words as is."""
    if got.get("error") != "pack_boundary":
        bad.append(f"{where}: error {got.get('error')!r}, want 'pack_boundary' ({got})")
    if got.get("reasonCode") != PACK_BLOCKED:
        bad.append(f"{where}: reasonCode {got.get('reasonCode')!r}, want {PACK_BLOCKED!r} ({got})")
    if got.get("message") != want_message:
        bad.append(f"{where}: message {got.get('message')!r}, want {want_message!r}")


def test_a_block_without_the_words_was_blocked_is_still_a_block(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    _isolate_plugin_local: Path,
) -> None:
    """All five service callers (plugin_local install / publish / retry, the plugins.py catalog scan for
    a fresh pack and for an update) answer a reworded block as a block, from the code alone."""
    monkeypatch.setattr(pack_block_copy, "BLOCK_INSTALL", REWORDED_INSTALL)
    monkeypatch.setattr(pack_block_copy, "BLOCK_UPGRADE", REWORDED_UPGRADE)
    monkeypatch.setattr(pack_block_copy, "BLOCK_UPGRADE_OLD_UNKNOWN", REWORDED_UPGRADE_OLD_UNKNOWN)
    fresh = f"{NAME} got stopped because {SENTENCE} Nothing was installed, and your wall is unchanged. " \
        "If you made this pack, run pack lint to see what to fix."
    assert str(PackBlockedError(NAME, SENTENCE)) == fresh
    assert "was blocked" not in fresh
    _repo(tmp_path, monkeypatch)
    plugins.reset_bundles()
    bad: list[str] = []

    with monkeypatch.context() as m:
        m.setattr(plugins, "verify_pack_bundle_home", _blocked)
        # plugin_local.install_local_zip: a fresh install the lint blocked.
        _check("install_local_zip", plugin_local.install_local_zip(_pack(tmp_path, 1), overwrite=True), fresh, bad)
        # plugins.py catalog scan: the same zip in the drop zone, never installed.
        drop = paths.plugin_local_dir(create=True) / f"{PID}.zip"
        drop.write_bytes(_pack(tmp_path, 1))
        rows = _catalog_rows()
        if len(rows) != 1:
            bad.append(f"catalog scan (fresh): rows {rows}")
        for row in rows:
            _check("catalog scan (fresh)", row, fresh, bad)

        # plugin_local.retry_blocked_zip_install: retrying the recorded block is blocked again.
        from service import plugin_zip as pz
        from service.pack_zip_blocks import record_zip_block

        digest = pz.plugin_sha256(drop)
        record_zip_block(digest, {"id": PID, "name": NAME, "error": "pack_boundary", "message": fresh, "zip": str(drop)})
        _check("retry_blocked_zip_install", plugin_local.retry_blocked_zip_install(digest, activate=False), fresh, bad)
        drop.unlink()
        plugins.reset_scan_memo()

    # plugin_local.publish_local: a block raised out of the install it wraps.
    with monkeypatch.context() as m:
        m.setattr(plugin_local, "_payload_bytes", lambda _args: b"")
        m.setattr(plugin_local, "install_local_zip", lambda *_a, **_k: _blocked())
        _check("publish_local", plugin_local.publish_local({}), fresh, bad)

    # plugins.py catalog scan, an update: v1 installed, a blocked v2 dropped in.
    plugin_local.install_local_zip(_pack(tmp_path, 1), overwrite=True)
    assert (paths.plugin_local_runtime_dir(create=True) / PID / "plugin.yml").is_file(), "v1 installed"
    plugins.scan()
    upgrade = f"{NAME} got stopped because {SENTENCE} Nothing was updated, so version 1 is still installed. " \
        "If you made this pack, run pack lint to see what to fix."
    with monkeypatch.context() as m:
        m.setattr(plugins, "verify_pack_bundle_home", _blocked)
        (paths.plugin_local_dir() / f"{PID}.zip").write_bytes(_pack(tmp_path, 2))
        rows = _catalog_rows()
    if len(rows) != 1:
        bad.append(f"catalog scan (update): rows {rows}")
    for row in rows:
        _check("catalog scan (update)", row, upgrade, bad)

    assert not bad, "\n".join(bad)
    assert getattr(pack_install_copy, "REASON_PACK_BLOCKED", None) == PACK_BLOCKED
    assert getattr(PackBlockedError, "reason_code", None) == PACK_BLOCKED
