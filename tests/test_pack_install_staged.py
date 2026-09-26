from __future__ import annotations

import io
import json
import zipfile
from pathlib import Path

import pytest

from service import mcp as plugin_mcp
from service import paths
from service import plugin_install as pi
from service import plugin_local
from service import plugin_zip as pz
from service.pack_install_blocked_store import pack_info_blocked_line, reset_blocked_store_for_tests
from service.pack_install_copy import REASON_SCHEMA_INVALID
from service.pack_install_wall_notices import reset_wall_notices_for_tests
from service.plugin_install import InstallBlocked, InstallContext, InstallValidator, register_install_validator

MINIMAL = "id: sample\nname: Sample\nversion: 1\n"


def _zip(files: dict[str, str]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        for name, body in files.items():
            zf.writestr(name, body)
    return buf.getvalue()


def _repo(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    repo = tmp_path / "checkout"
    (repo / "plugins" / "src").mkdir(parents=True)
    (repo / "plugins" / ".runtime").mkdir(parents=True)
    monkeypatch.setenv("ZOTO_VIZ_REPO_ROOT", str(repo))
    return repo


def _isolate_local(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """Use the conftest-patched local drop zone (``paths.plugin_local_dir``)."""
    del tmp_path, monkeypatch  # repo root only; drop zone comes from tests/conftest.py
    return paths.plugin_local_dir(create=True)


@pytest.fixture(autouse=True)
def _reset_install_state() -> None:
    pi.reset_install_pipeline_for_tests()
    reset_blocked_store_for_tests()
    reset_wall_notices_for_tests()
    plugin_local.reset_watch_for_tests()


def test_register_install_validator_runs_in_order() -> None:
    seen: list[str] = []

    def second(_ctx: InstallContext) -> None:
        seen.append("second")
        raise InstallBlocked(REASON_SCHEMA_INVALID, "second fail", validator="second")

    register_install_validator(InstallValidator("second", 25, second))
    staging = Path("/tmp/staging-x")
    staging.mkdir(exist_ok=True)
    (staging / "plugin.yml").write_text(MINIMAL, encoding="utf-8")
    ctx = InstallContext(
        staging=staging,
        runtime=Path("."),
        dest_zip=Path("."),
        doc={"id": "x", "name": "X"},
        sha256="abc",
        upgrade=False,
        rel="z.zip",
        zip_path=Path("."),
    )
    first, all_fail = pi.run_staging_validators(ctx)
    assert first is not None
    assert first.validator == "second"
    assert len(all_fail) == 1


def test_blocked_update_keeps_old_version(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    _repo(tmp_path, monkeypatch)
    _isolate_local(tmp_path, monkeypatch)
    good = _zip({"plugin.yml": MINIMAL, "visualisation.yml": "engine: graph\nbase: topology\n"})
    first = plugin_local.publish_local({"zip_b64": __import__("base64").b64encode(good).decode()})
    assert first["ok"] is True
    dest = paths.plugin_local_dir() / "sample.zip"
    runtime = paths.plugin_local_runtime_dir() / "sample"
    old_zip = dest.read_bytes()
    old_hash = pi.runtime_tree_hash(runtime)

    def reject(_ctx: InstallContext) -> None:
        raise InstallBlocked(REASON_SCHEMA_INVALID, "update blocked for test", validator="test_reject")

    register_install_validator(InstallValidator("test_reject", 5, reject))
    bad = _zip({"plugin.yml": "id: sample\nname: Sample\nversion: 2\n"})
    blocked = plugin_local.publish_local(
        {"zip_b64": __import__("base64").b64encode(bad).decode(), "overwrite": True},
    )
    assert blocked["ok"] is False
    assert dest.read_bytes() == old_zip
    assert pi.runtime_tree_hash(runtime) == old_hash
    assert not pi.list_staging_dirs(paths.plugin_local_runtime_dir())


def test_all_entry_points_agree_on_rejected_zip(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    _repo(tmp_path, monkeypatch)
    local = _isolate_local(tmp_path, monkeypatch)
    bad = _zip({"plugin.yml": MINIMAL})

    def reject(_ctx: InstallContext) -> None:
        raise InstallBlocked(REASON_SCHEMA_INVALID, "same copy", validator="test_reject")

    register_install_validator(InstallValidator("test_reject", 5, reject))
    b64 = __import__("base64").b64encode(bad).decode()
    web = plugin_local.publish_local({"zip_b64": b64})
    drop = local / "scan-sample.zip"
    drop.write_bytes(_zip({"plugin.yml": "id: scan-sample\nname: Scan\nversion: 1\n"}))
    scan = plugin_local.adopt_local_zip_file(drop, activate=True)
    mcp = plugin_mcp.call_tool("install_plugin_zip", {"zip_b64": b64, "force": True})
    mcp_payload = json.loads(mcp["content"][0]["text"])
    keys = ("ok", "error", "message")
    for label, payload in (("web", web), ("scan", scan), ("mcp", mcp_payload)):
        assert payload.get("ok") is False, label
        assert payload.get("message") == web.get("message"), label
        for k in keys:
            assert payload.get(k) == web.get(k), f"{label} {k}"


def test_first_failure_only_logs_both(caplog: pytest.LogCaptureFixture, tmp_path: Path) -> None:
    caplog.set_level("INFO")

    def second(_ctx: InstallContext) -> None:
        raise InstallBlocked(REASON_SCHEMA_INVALID, "second validator", validator="second")

    register_install_validator(InstallValidator("second", 25, second))
    staging = tmp_path / "staging"
    staging.mkdir()
    (staging / "plugin.yml").write_text("id: bad\nname: Bad\n", encoding="utf-8")
    zip_path = tmp_path / "in.zip"
    zip_path.write_bytes(_zip({"plugin.yml": MINIMAL}))
    ctx = InstallContext(
        staging=staging,
        runtime=Path("."),
        dest_zip=Path("."),
        doc={"id": "bad", "name": "Bad", "version": 1},
        sha256="deadbeef",
        upgrade=False,
        rel="z.zip",
        zip_path=zip_path,
    )
    first, all_fail = pi.run_staging_validators(ctx)
    assert first is not None
    assert first.validator == "schema"
    assert len(all_fail) == 2
    assert sum(1 for r in caplog.records if "validator failed" in r.getMessage()) == 2
    result = pi.blocked_result(first, pack_id="bad", sha256="deadbeef", zip_path="z.zip")
    assert result["message"] == first.message
    assert "second validator" not in result["message"]


def test_three_scans_one_wall_notice_and_pack_info_line(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    _repo(tmp_path, monkeypatch)
    local = _isolate_local(tmp_path, monkeypatch)

    def reject(_ctx: InstallContext) -> None:
        raise InstallBlocked(REASON_SCHEMA_INVALID, "scan blocked", validator="test_reject")

    register_install_validator(InstallValidator("test_reject", 5, reject))
    bad = _zip({"plugin.yml": MINIMAL})
    z = local / "sample.zip"
    z.write_bytes(bad)
    row = plugin_local.adopt_local_zip_file(z, activate=True)
    assert row.get("ok") is False
    assert pack_info_blocked_line("sample") == row.get("message")
    notices = len(row.get("installNotices") or [])
    assert row.get("packInstallBlocked")
    for _ in range(2):
        again = plugin_local.adopt_local_zip_file(z, activate=True)
        assert again.get("ok") is False
        assert pack_info_blocked_line("sample") == row.get("message")
    assert notices == 1
    pi.reset_install_pipeline_for_tests()
    good = _zip({"plugin.yml": MINIMAL, "visualisation.yml": "engine: graph\nbase: topology\n"})
    z.write_bytes(good)
    ok_row = plugin_local.adopt_local_zip_file(z, activate=True)
    assert ok_row.get("ok") is True
    assert pack_info_blocked_line("sample") is None


def test_atomic_swap_failure_keeps_old_and_cleans_staging(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    _repo(tmp_path, monkeypatch)
    _isolate_local(tmp_path, monkeypatch)
    good = _zip({"plugin.yml": MINIMAL, "visualisation.yml": "engine: graph\nbase: topology\n"})
    first = plugin_local.publish_local({"zip_b64": __import__("base64").b64encode(good).decode()})
    assert first["ok"] is True
    dest = paths.plugin_local_dir() / "sample.zip"
    runtime = paths.plugin_local_runtime_dir() / "sample"
    old_hash = pi.runtime_tree_hash(runtime)

    def boom() -> None:
        raise OSError("rename failed")

    pi.set_after_first_rename(boom)
    v2 = _zip({"plugin.yml": "id: sample\nname: Sample\nversion: 2\n", "visualisation.yml": "engine: graph\nbase: topology\n"})
    try:
        with pytest.raises(OSError):
            plugin_local.publish_local(
                {"zip_b64": __import__("base64").b64encode(v2).decode(), "overwrite": True},
            )
    finally:
        pi.set_after_first_rename(None)
    assert pi.runtime_tree_hash(runtime) == old_hash
    assert not pi.list_staging_dirs(paths.plugin_local_runtime_dir())
