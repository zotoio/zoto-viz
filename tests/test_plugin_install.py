from __future__ import annotations

import base64
import io
import os
import shutil
import stat
import subprocess
import sys
import tempfile
import threading
import zipfile
from pathlib import Path

import pytest

from service import paths
from service import plugin_local
from service import plugin_zip as pz
from service import plugins
from service.pack_install_lint import run_install_pack_lint
from service import plugin_install as plugin_install_mod
from service.plugin_install import (
    InstallStartFailedError,
    InstallV2BlockedError,
    drain_install_notices,
    install_zip_to_runtime,
    list_bak_dirs,
    list_staging_dirs,
    pack_install_lock,
    read_install_state,
    recover_all_runtime_roots,
    recover_interrupted_swaps,
    runtime_tree_hash,
    should_skip_unchanged_zip,
    staging_root,
)


def _assert_runtime_parent_clean(runtime_parent: Path) -> None:
    staging = list_staging_dirs(runtime_parent)
    assert not staging, f"staging left: {staging}"
    baks = list_bak_dirs(runtime_parent)
    assert not baks, f".bak left: {baks}"


def _reset_install_locks_for_tests() -> None:
    plugin_install_mod._pack_install_locks.clear()


def _clear_zip_block_store() -> None:
    from service.pack_zip_blocks import LEGACY_STORE_NAME, _invalidate_cache

    _invalidate_cache()
    local = paths.plugin_local_dir(create=False)
    if not local.is_dir():
        return
    legacy = local / LEGACY_STORE_NAME
    legacy.unlink(missing_ok=True)
    blocks = local / "blocks"
    if blocks.is_dir():
        for child in blocks.iterdir():
            if child.is_file():
                child.unlink(missing_ok=True)
        try:
            blocks.rmdir()
        except OSError:
            pass


def _clear_install_catalog_records() -> None:
    import service.pack_install_catalog as catalog_mod

    with catalog_mod._LOCK:
        catalog_mod._CACHE = None
    path = paths.plugin_local_dir(create=False) / ".install-catalog-records.json"
    path.unlink(missing_ok=True)


def _pack_fixture(name: str) -> Path:
    root = Path(__file__).resolve().parents[1]
    return root / "plugins/sdk/pack-bundle-fixtures" / name


def _zip_tree(src: Path) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        for path in src.rglob("*"):
            if path.is_file():
                zf.write(path, path.relative_to(src).as_posix())
    return buf.getvalue()


def _repo(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    repo = tmp_path / "checkout"
    (repo / "plugins" / "src").mkdir(parents=True)
    (repo / "plugins" / ".runtime").mkdir(parents=True)
    monkeypatch.setenv("ZOTO_VIZ_REPO_ROOT", str(repo))
    return repo


def _runtime_parent() -> Path:
    return paths.plugin_local_runtime_dir(create=True)


def _bump_pack(tmp_path: Path, n: int) -> bytes:
    src = tmp_path / f"v{n}"
    shutil.copytree(_pack_fixture("upgrade-probe"), src)
    yml = src / "plugin.yml"
    yml.write_text(
        yml.read_text(encoding="utf-8").replace("version: 1", f"version: {n}"),
        encoding="utf-8",
    )
    (src / "frontend" / "sdk" / "marker.ts").write_text(
        f'export const marker = "upgrade-v{n}";\n',
        encoding="utf-8",
    )
    return _zip_tree(src)


def _zip_with_symlink(plugin_yml: str, link_name: str, target: str) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("plugin.yml", plugin_yml)
        info = zipfile.ZipInfo(link_name)
        info.external_attr = (stat.S_IFLNK | 0o755) << 16
        zf.writestr(info, target)
    return buf.getvalue()


@pytest.fixture(autouse=True)
def _reset_hooks(monkeypatch: pytest.MonkeyPatch) -> None:
    import service.plugin_install as plugin_install_mod
    monkeypatch.setattr(plugin_install_mod, "_after_first_rename", None, raising=False)
    monkeypatch.setattr(plugin_install_mod, "_start_runtime_hook", None, raising=False)
    plugin_install_mod._pending_notices.clear()
    plugin_install_mod._swap_in_progress.clear()
    _reset_install_locks_for_tests()
    drain_install_notices()
    _clear_zip_block_store()
    _clear_install_catalog_records()
    plugin_local.reset_watch_for_tests()










def test_interrupted_swap_uses_after_first_rename_hook(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    _isolate_plugin_local: Path,
) -> None:
    _repo(tmp_path, monkeypatch)
    plugins.reset_bundles()
    v1 = _zip_tree(_pack_fixture("upgrade-probe"))
    v2 = _bump_pack(tmp_path, 2)
    pid = "upgrade-probe"
    plugin_local.install_local_zip(v1, overwrite=True)
    zip_v1_sha = pz.plugin_sha256(paths.plugin_local_dir() / f"{pid}.zip")
    marker_v1 = (_runtime_parent() / pid / "frontend/sdk/marker.ts").read_text(encoding="utf-8")

    hook_calls = 0

    def after_first_rename() -> None:
        nonlocal hook_calls
        hook_calls += 1
        raise RuntimeError("simulated kill between renames")

    dest = paths.plugin_local_dir() / f"{pid}.zip"
    runtime = _runtime_parent() / pid
    doc = plugins.validate_doc(pz.inspect_zip(dest).plugin)
    fd, tmp = tempfile.mkstemp(suffix=".zip")
    os.write(fd, v2)
    os.close(fd)
    tmp_path_zip = Path(tmp)
    try:
        monkeypatch.setattr("service.plugin_install._after_first_rename", after_first_rename)
        with pytest.raises(RuntimeError, match="simulated kill between renames"):
            install_zip_to_runtime(
                tmp_path_zip,
                dest,
                runtime,
                doc,
                rel=str(dest),
                sha256=pz.plugin_sha256(tmp_path_zip),
                upgrade=True,
            )
    finally:
        tmp_path_zip.unlink(missing_ok=True)

    assert hook_calls == 1
    bak = runtime.parent / f"{pid}.bak"
    assert bak.is_dir()
    assert not runtime.exists()
    assert pz.plugin_sha256(dest) == zip_v1_sha

    from service.pack_install_catalog import peek_catalog_records

    msgs = recover_interrupted_swaps(runtime.parent)
    assert len(msgs) == 1
    assert "interrupted" in msgs[0]
    records = peek_catalog_records()
    assert any(r.get("error") == "pack_install_interrupted" for r in records)
    assert runtime.is_dir()
    assert (runtime / "frontend/sdk/marker.ts").read_text(encoding="utf-8") == marker_v1
    _assert_runtime_parent_clean(runtime.parent)




def test_start_failed_zip_hash_blocks_rescan_notice_once(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    _isolate_plugin_local: Path,
) -> None:
    """Revert: early zip overwrite + no hash block → second scan reinstalls v2 (see PR body)."""
    from service.pack_zip_blocks import zip_block_for_sha

    _repo(tmp_path, monkeypatch)
    plugins.reset_bundles()
    pid = "upgrade-probe"
    plugin_local.install_local_zip(_zip_tree(_pack_fixture("upgrade-probe")), overwrite=True)
    marker_v1 = (_runtime_parent() / pid / "frontend/sdk/marker.ts").read_text(encoding="utf-8")
    plugins.scan()
    digest_v1, _ = plugins.bundle_for(pid)
    v2 = _bump_pack(tmp_path, 2)
    fd, tmp_v2 = tempfile.mkstemp(suffix=".zip")
    os.write(fd, v2)
    os.close(fd)
    v2_sha = pz.plugin_sha256(Path(tmp_v2))
    Path(tmp_v2).unlink(missing_ok=True)
    monkeypatch.setattr(
        "service.plugin_install._start_runtime",
        lambda *_a, **_k: (_ for _ in ()).throw(RuntimeError("nope")),
    )
    with pytest.raises(InstallStartFailedError):
        plugin_local.install_local_zip(v2, overwrite=True)
    assert zip_block_for_sha(v2_sha) is not None
    bad = paths.plugin_local_dir() / f"{pid}.zip"
    bad.write_bytes(v2)
    plugin_local._seen[str(bad.resolve())] = "force-rescan"
    notices: list[str] = []
    for _ in range(2):
        plugin_local.sync_local_drop()
        plugins.reset_scan_memo()
        scan = plugins.scan()
        failed = [e for e in scan["errors"] if e.get("blockReason") == "couldnt_start"]
        assert len(failed) == 1
        assert failed[0].get("message", "").find("couldn't start") >= 0
        notices.append(failed[0]["message"])
        assert (_runtime_parent() / pid / "frontend/sdk/marker.ts").read_text(encoding="utf-8") == marker_v1
        plugins.scan()
        digest_after, _ = plugins.bundle_for(pid)
        assert digest_after == digest_v1
    assert notices[0] == notices[1]


def test_retry_blocked_zip_runs_full_install_keeps_v1_on_repeat_failure(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    _isolate_plugin_local: Path,
) -> None:
    """Revert: Retry only clear_zip_block + sync → next scan installs v2 (see PR body)."""
    from service.pack_zip_blocks import zip_block_for_sha

    _repo(tmp_path, monkeypatch)
    plugins.reset_bundles()
    pid = "upgrade-probe"
    plugin_local.install_local_zip(_zip_tree(_pack_fixture("upgrade-probe")), overwrite=True)
    marker_v1 = (_runtime_parent() / pid / "frontend/sdk/marker.ts").read_text(encoding="utf-8")
    plugins.scan()
    digest_v1, _ = plugins.bundle_for(pid)
    v2 = _bump_pack(tmp_path, 2)
    fd, tmp_v2 = tempfile.mkstemp(suffix=".zip")
    os.write(fd, v2)
    os.close(fd)
    v2_sha = pz.plugin_sha256(Path(tmp_v2))
    Path(tmp_v2).unlink(missing_ok=True)
    monkeypatch.setattr(
        "service.plugin_install._start_runtime",
        lambda *_a, **_k: (_ for _ in ()).throw(RuntimeError("nope")),
    )
    with pytest.raises(InstallStartFailedError):
        plugin_local.install_local_zip(v2, overwrite=True)
    (paths.plugin_local_dir() / f"{pid}.zip").write_bytes(v2)
    first_msg = zip_block_for_sha(v2_sha)["message"]
    drain_install_notices()

    from service.pack_install_retry import RETRY_RESULT_START_FAILED, format_retry_start_failed_message

    info = plugin_local.retry_blocked_zip_install(v2_sha, activate=False)
    assert info.get("ok") is False
    assert info.get("error") == "pack_install_start_failed"
    assert info.get("retryResult") == RETRY_RESULT_START_FAILED
    still_msg = format_retry_start_failed_message(str(info.get("name") or pid), info.get("version") or 2)
    assert info.get("message") == still_msg
    assert (_runtime_parent() / pid / "frontend/sdk/marker.ts").read_text(encoding="utf-8") == marker_v1
    plugins.scan()
    digest_after, _ = plugins.bundle_for(pid)
    assert digest_after == digest_v1
    second = zip_block_for_sha(v2_sha)
    assert second is not None
    assert second["message"] == still_msg
    assert drain_install_notices() == []

    plugin_local.retry_blocked_zip_install(v2_sha, activate=False)
    assert zip_block_for_sha(v2_sha) is not None
    assert drain_install_notices() == []


def test_retry_zip_hash_mismatch_returns_409_without_installing(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    _isolate_plugin_local: Path,
) -> None:
    from service.pack_zip_blocks import zip_block_for_sha

    _repo(tmp_path, monkeypatch)
    plugins.reset_bundles()
    pid = "upgrade-probe"
    plugin_local.install_local_zip(_zip_tree(_pack_fixture("upgrade-probe")), overwrite=True)
    marker_v1 = (_runtime_parent() / pid / "frontend/sdk/marker.ts").read_text(encoding="utf-8")
    v2 = _bump_pack(tmp_path, 2)
    v3 = _bump_pack(tmp_path, 3)
    fd, tmp_v2 = tempfile.mkstemp(suffix=".zip")
    os.write(fd, v2)
    os.close(fd)
    v2_sha = pz.plugin_sha256(Path(tmp_v2))
    Path(tmp_v2).unlink(missing_ok=True)
    monkeypatch.setattr(
        "service.plugin_install._start_runtime",
        lambda *_a, **_k: (_ for _ in ()).throw(RuntimeError("nope")),
    )
    with pytest.raises(InstallStartFailedError):
        plugin_local.install_local_zip(v2, overwrite=True)
    dest = paths.plugin_local_dir() / f"{pid}.zip"
    dest.write_bytes(v3)
    from service.pack_install_retry import RETRY_RESULT_ZIP_CHANGED, format_retry_zip_changed_message

    info = plugin_local.retry_blocked_zip_install(v2_sha, activate=False)
    assert info.get("retryResult") == RETRY_RESULT_ZIP_CHANGED
    assert info.get("error") == "zip_hash_mismatch"
    row = zip_block_for_sha(v2_sha)
    assert info.get("message") == format_retry_zip_changed_message(str(row.get("name") or pid), pid)
    assert zip_block_for_sha(v2_sha) is not None
    assert (_runtime_parent() / pid / "frontend/sdk/marker.ts").read_text(encoding="utf-8") == marker_v1


def _blocked_v2_setup(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> tuple[str, str, str, bytes]:
    _reset_install_locks_for_tests()
    _repo(tmp_path, monkeypatch)
    plugins.reset_bundles()
    pid = "upgrade-probe"
    plugin_local.install_local_zip(_zip_tree(_pack_fixture("upgrade-probe")), overwrite=True)
    v2 = _bump_pack(tmp_path, 2)
    monkeypatch.setattr(
        "service.plugin_install._start_runtime",
        lambda *_a, **_k: (_ for _ in ()).throw(RuntimeError("nope")),
    )
    with pytest.raises(InstallStartFailedError):
        plugin_local.install_local_zip(v2, overwrite=True)
    fd, tmp_v2 = tempfile.mkstemp(suffix=".zip")
    os.write(fd, v2)
    os.close(fd)
    v2_sha = pz.plugin_sha256(Path(tmp_v2))
    Path(tmp_v2).unlink(missing_ok=True)
    dest = paths.plugin_local_dir() / f"{pid}.zip"
    dest.write_bytes(v2)
    plugin_local._seen[str(dest.resolve())] = "stale-for-race"
    return pid, v2_sha, (_runtime_parent() / pid / "frontend/sdk/marker.ts").read_text(encoding="utf-8"), v2


def test_retry_and_scan_race_single_install(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    _isolate_plugin_local: Path,
) -> None:
    from service import plugin_install as pi

    pid, v2_sha, marker_v1, _v2 = _blocked_v2_setup(tmp_path, monkeypatch)
    install_calls = 0
    hold = threading.Event()
    release = threading.Event()
    real_locked = pi._install_zip_to_runtime_locked

    def wrapped(*args, **kwargs):
        nonlocal install_calls
        install_calls += 1
        hold.set()
        assert release.wait(timeout=5)
        return real_locked(*args, **kwargs)

    monkeypatch.setattr(pi, "_install_zip_to_runtime_locked", wrapped)

    go = threading.Event()

    def scan_worker() -> None:
        go.wait(timeout=5)
        plugin_local.sync_local_drop()
        plugins.reset_scan_memo()
        plugins.scan()

    def retry_worker() -> None:
        go.wait(timeout=5)
        plugin_local.retry_blocked_zip_install(v2_sha, activate=False)

    t_scan = threading.Thread(target=scan_worker, daemon=True)
    t_retry = threading.Thread(target=retry_worker, daemon=True)
    t_scan.start()
    t_retry.start()
    go.set()
    assert hold.wait(timeout=5)
    release.set()
    t_scan.join(timeout=15)
    t_retry.join(timeout=15)
    assert install_calls == 1
    assert (_runtime_parent() / pid / "frontend/sdk/marker.ts").read_text(encoding="utf-8") == marker_v1
    blocks_dir = paths.plugin_local_dir(create=False) / "blocks"
    assert len(list(blocks_dir.glob("*.json"))) == 1


def test_retry_and_scan_race_single_install_20_of_20(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    _isolate_plugin_local: Path,
) -> None:
    for n in range(20):
        _reset_install_locks_for_tests()
        drain_install_notices()
        _clear_zip_block_store()
        _clear_install_catalog_records()
        plugin_local.reset_watch_for_tests()
        plugins.reset_bundles()
        sub = tmp_path / f"race{n}"
        local_root = sub / "plugin-local"
        local_root.mkdir(parents=True)
        loop_mp = pytest.MonkeyPatch()
        loop_mp.setenv("ZOTO_VIZ_PLUGIN_LOCAL", str(local_root))
        try:
            test_retry_and_scan_race_single_install(sub, loop_mp, local_root)
        finally:
            loop_mp.undo()






def test_concurrent_install_passes_20_of_20(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    _isolate_plugin_local: Path,
) -> None:
    for attempt in range(20):
        _reset_install_locks_for_tests()
        drain_install_notices()
        plugin_local.reset_watch_for_tests()
        plugins.reset_bundles()
        _repo(tmp_path / f"r{attempt}", monkeypatch)
        pid = "upgrade-probe"
        plugin_local.install_local_zip(_zip_tree(_pack_fixture("upgrade-probe")), overwrite=True)
        first_in_hook = threading.Event()
        release_hook = threading.Event()
        errors: list[BaseException] = []

        def after_first_rename() -> None:
            first_in_hook.set()
            release_hook.wait(timeout=5)

        monkeypatch.setattr("service.plugin_install._after_first_rename", after_first_rename)
        t1 = threading.Thread(
            target=lambda: plugin_local.install_local_zip(_bump_pack(tmp_path / f"r{attempt}", 2), overwrite=True),
            daemon=True,
        )
        t2 = threading.Thread(
            target=lambda: plugin_local.install_local_zip(_bump_pack(tmp_path / f"r{attempt}", 3), overwrite=True),
            daemon=True,
        )
        t1.start()
        assert first_in_hook.wait(timeout=5)
        t2.start()
        release_hook.set()
        t1.join(timeout=10)
        t2.join(timeout=10)
        if errors:
            raise errors[0]
        _assert_runtime_parent_clean(_runtime_parent())




def test_zip_slip_rejected_on_unpack(tmp_path: Path) -> None:
    zpath = tmp_path / "slip.zip"
    with zipfile.ZipFile(zpath, "w") as zf:
        zf.writestr("plugin.yml", "id: slip-test\nname: Slip\nversion: 1\n")
        zf.writestr("../escape.yml", "nope\n")
    dest = tmp_path / "out"
    dest.mkdir()
    with pytest.raises(ValueError, match="illegal zip path"):
        pz.unpack_zip(zpath, dest)


def test_symlink_zip_rejected_via_install_pipeline(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    _isolate_plugin_local: Path,
) -> None:
    _repo(tmp_path, monkeypatch)
    plugins.reset_bundles()
    yml = "id: sym-test\nname: Sym\nversion: 1\nengine: graph\nbase: topology\n"
    raw = _zip_with_symlink(yml, "link.ts", "../escape.ts")
    with pytest.raises(ValueError, match="symlink"):
        plugin_local.install_local_zip(raw, overwrite=True)
    assert not (_runtime_parent() / "sym-test").exists()
    _assert_runtime_parent_clean(_runtime_parent())


def test_unchanged_zip_skips_reinstall_on_three_scans(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    _isolate_plugin_local: Path,
) -> None:
    _repo(tmp_path, monkeypatch)
    plugins.reset_bundles()
    pid = "upgrade-probe"
    raw = _zip_tree(_pack_fixture("upgrade-probe"))
    plugin_local.install_local_zip(raw, overwrite=True)
    dest = paths.plugin_local_dir() / f"{pid}.zip"
    runtime = _runtime_parent() / pid
    sha = pz.plugin_sha256(dest)
    swaps = 0
    lint_calls = 0

    def counting_lint(home: Path):
        nonlocal lint_calls
        lint_calls += 1
        return run_install_pack_lint(home)

    monkeypatch.setattr("service.plugin_install.run_install_pack_lint", counting_lint)

    def bump_swap() -> None:
        nonlocal swaps
        swaps += 1

    monkeypatch.setattr("service.plugin_install._after_first_rename", bump_swap)
    plugin_local._primed = True
    plugin_local._seen[str(dest.resolve())] = "stale"
    for _ in range(3):
        plugin_local.sync_local_drop()
    assert swaps == 0
    assert lint_calls == 0
    assert should_skip_unchanged_zip(dest, runtime, sha)
    assert read_install_state(runtime.parent).get(pid) == sha




def test_sdk_contract_still_checked_on_install(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    _isolate_plugin_local: Path,
) -> None:
    from service import pack_sdk_contract as psc

    _repo(tmp_path, monkeypatch)
    plugins.reset_bundles()
    err = psc.catalog_sdk_contract_error("x.zip", {"id": "x", "name": "X"}, 0, 99)
    monkeypatch.setattr(
        "service.plugin_install.assert_pack_sdk_compatible",
        lambda *_a, **_k: err,
    )
    raw = _zip_tree(_pack_fixture("upgrade-probe"))
    with pytest.raises(ValueError, match="zoto-viz"):
        plugin_local.install_local_zip(raw, overwrite=True)


def test_install_local_unchanged_zip_routes_through_pipeline(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    _isolate_plugin_local: Path,
) -> None:
    from service import plugin_install as pi

    _repo(tmp_path, monkeypatch)
    plugins.reset_bundles()
    raw = _zip_tree(_pack_fixture("upgrade-probe"))
    calls = 0
    real = pi.install_zip_to_runtime

    def counting(*args: object, **kwargs: object) -> object:
        nonlocal calls
        calls += 1
        return real(*args, **kwargs)

    monkeypatch.setattr(plugin_local, "install_zip_to_runtime", counting)
    plugin_local.install_local_zip(raw, overwrite=True)
    plugin_local.install_local_zip(raw, overwrite=True)
    assert calls == 2




def _minimal_plugin_zip(plugin_id: str) -> bytes:
    yml = f"id: {plugin_id}\nname: Fresh\nversion: 1\n"
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("plugin.yml", yml)
    return buf.getvalue()


def test_startup_recovery_runs_in_fresh_process(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    _isolate_plugin_local: Path,
) -> None:
    _repo(tmp_path, monkeypatch)
    plugins.reset_bundles()
    pid = "upgrade-probe"
    plugin_local.install_local_zip(_zip_tree(_pack_fixture("upgrade-probe")), overwrite=True)
    runtime = _runtime_parent() / pid
    bak = runtime.parent / f"{pid}.bak"
    runtime.rename(bak)
    script = """
from service.plugin_install import recover_all_runtime_roots
from service.pack_install_catalog import peek_catalog_records
msgs = recover_all_runtime_roots()
records = peek_catalog_records()
import json
print(json.dumps({"msgs": msgs, "records": records}))
"""
    env = os.environ.copy()
    root = Path(__file__).resolve().parents[1]
    env["PYTHONPATH"] = str(root)
    env["ZOTO_VIZ_PLUGIN_LOCAL"] = str(_isolate_plugin_local)
    out = subprocess.check_output([sys.executable, "-c", script], env=env, text=True)
    payload = __import__("json").loads(out)
    assert payload["msgs"]
    assert len(payload["records"]) >= 1
    assert runtime.is_dir()
    assert not bak.exists()
