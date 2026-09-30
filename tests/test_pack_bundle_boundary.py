from __future__ import annotations

import base64
import io
import zipfile
from pathlib import Path

import pytest

from service import paths
from service import plugin_local
from service import plugin_zip as pz
from service import plugins
from service.pack_boundary import PackBundleBoundary, format_blocked_message, format_upgrade_blocked_message
from service.pack_runtime import runtime_has_partial_bundle


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


@pytest.mark.parametrize(
    ("fixture", "pack_id"),
    [
        ("host-escape", "pack-boundary-host-escape"),
        ("json-escape", "pack-boundary-json-escape"),
    ],
)
def test_install_local_zip_blocks_bad_bundle(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    fixture: str,
    pack_id: str,
    _isolate_plugin_local: Path,
) -> None:
    _repo(tmp_path, monkeypatch)
    plugins.reset_bundles()
    raw = _zip_tree(_pack_fixture(fixture))
    info = plugin_local.publish_local({"zip_b64": base64.b64encode(raw).decode(), "activate": True})
    assert info["ok"] is False
    assert info.get("error") == "pack_boundary"
    assert "was blocked" in info.get("message", "")
    assert "Nothing was installed" in info.get("message", "")
    assert pack_id not in {p["id"] for p in plugins.scan()["plugins"]}
    assert not (paths.plugin_local_dir() / f"{pack_id}.zip").is_file()
    runtime = paths.plugin_local_runtime_dir() / pack_id
    assert not runtime.exists()
    assert not runtime_has_partial_bundle(runtime)


@pytest.mark.parametrize(
    ("fixture", "pack_id"),
    [
        ("host-escape", "pack-boundary-host-escape"),
        ("json-escape", "pack-boundary-json-escape"),
    ],
)
def test_scan_local_zip_blocks_bad_bundle(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    fixture: str,
    pack_id: str,
    _isolate_plugin_local: Path,
) -> None:
    _repo(tmp_path, monkeypatch)
    plugins.reset_bundles()
    local = paths.plugin_local_dir(create=True)
    zip_path = local / f"{pack_id}.zip"
    zip_path.write_bytes(_zip_tree(_pack_fixture(fixture)))
    result = plugins.scan()
    assert pack_id not in {p["id"] for p in result["plugins"]}
    blocked = [e for e in result["errors"] if e.get("error") == "pack_boundary"]
    assert blocked
    assert "was blocked" in blocked[0].get("message", "")
    runtime = paths.plugin_local_runtime_dir() / pack_id
    assert not runtime.exists()


@pytest.mark.parametrize(
    ("fixture", "pack_id"),
    [
        ("host-escape", "pack-boundary-host-escape"),
        ("json-escape", "pack-boundary-json-escape"),
    ],
)
def test_scan_contrib_zip_blocks_bad_bundle(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    fixture: str,
    pack_id: str,
) -> None:
    repo = _repo(tmp_path, monkeypatch)
    plugins.reset_bundles()
    zips = paths.plugin_zips_dir()
    zips.mkdir(parents=True, exist_ok=True)
    zip_path = zips / f"{pack_id}.zip"
    zip_path.write_bytes(_zip_tree(_pack_fixture(fixture)))
    result = plugins.scan(repo)
    assert pack_id not in {p["id"] for p in result["plugins"]}
    blocked = [e for e in result["errors"] if e.get("error") == "pack_boundary"]
    assert blocked
    runtime = paths.plugin_runtime_dir() / pack_id
    assert not runtime.exists()


def test_boundary_message_names_pack_and_import() -> None:
    msg = format_blocked_message(
        PackBundleBoundary(
            pack_id="koi",
            pack_name="Koi Pond",
            file="frontend/index.ts",
            import_spec="../../web/src/plugins/host",
        ),
    )
    # #185: one shape; the file and the import are diagnostics (to_dict "details"), not user text.
    assert msg == (
        "Koi Pond was blocked because it loads code from outside its own folder. "
        "Nothing was installed, and your wall is unchanged. "
        "If you made this pack, run pack lint to see what to fix."
    )
    assert "frontend/index.ts" not in msg and "../../web" not in msg
    row = PackBundleBoundary(
        pack_id="koi", pack_name="Koi Pond", file="frontend/index.ts", import_spec="../../web/src/plugins/host"
    ).to_dict()
    assert row["message"] == msg
    assert "frontend/index.ts imports ../../web/src/plugins/host" in row["details"]
    assert "README" not in row["hint"] and "plugins/" not in row["hint"]


def test_blocked_pack_module_route_404(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    _isolate_plugin_local: Path,
) -> None:
    _repo(tmp_path, monkeypatch)
    plugins.reset_bundles()
    pack_id = "pack-boundary-host-escape"
    raw = _zip_tree(_pack_fixture("host-escape"))
    out = plugin_local.install_local_zip(raw)
    assert out.get("ok") is False
    assert out.get("error") == "pack_boundary"
    assert plugins.bundle_for(pack_id) is None

    class Req:
        match_info = {"id": pack_id}
        rel_url = type("U", (), {"query": {}})()

    resp = plugins.api_module(Req())
    assert resp.status == 404


def test_upgrade_blocked_preserves_v1_bundle(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    _isolate_plugin_local: Path,
) -> None:
    _repo(tmp_path, monkeypatch)
    plugins.reset_bundles()
    v1 = _zip_tree(_pack_fixture("upgrade-probe"))
    v2 = _zip_tree(_pack_fixture("upgrade-probe-bad"))
    pid = "upgrade-probe"
    ok = plugin_local.install_local_zip(v1, overwrite=True)
    assert ok.get("id") == pid
    digest_v1, bytes_v1 = plugins.bundle_for(pid)
    assert bytes_v1
    dest = paths.plugin_local_dir() / f"{pid}.zip"
    zip_v1_sha = pz.plugin_sha256(dest)
    runtime = paths.plugin_local_runtime_dir() / pid
    assert runtime.is_dir()
    assert (runtime / "frontend/sdk/marker.ts").is_file()

    blocked = plugin_local.install_local_zip(v2, overwrite=True)
    assert blocked.get("ok") is False
    # #185: the installed version (1, from the runtime plugin.yml), not a hard-coded v1.
    assert blocked.get("message") == (
        "Upgrade probe v2 bad was blocked because it tries to talk to the app directly, which packs aren't allowed to do. "
        "Nothing was updated, so version 1 is still installed. "
        "If you made this pack, run pack lint to see what to fix."
    )

    digest_after, bytes_after = plugins.bundle_for(pid)
    assert digest_after == digest_v1
    assert bytes_after == bytes_v1
    assert pz.plugin_sha256(dest) == zip_v1_sha
    assert pid in {p["id"] for p in plugins.scan()["plugins"]}
    assert (runtime / "frontend/sdk/marker.ts").is_file()
    assert not (runtime / "module.js").is_file()

    dest.write_bytes(v2)
    plugins.reset_scan_memo()
    scan_after = plugins.scan()
    assert pid in {p["id"] for p in scan_after["plugins"]}
    upgrade_err = [e for e in scan_after["errors"] if e.get("upgrade_blocked") == "true"]
    assert upgrade_err
    msg = upgrade_err[0].get("message", "")
    assert msg == (
        "Upgrade probe v2 bad was blocked because it tries to talk to the app directly, which packs aren't allowed to do. "
        "Nothing was updated, so version 1 is still installed. "
        "If you made this pack, run pack lint to see what to fix."
    )
    assert upgrade_err[0].get("zip") == str(dest)


def test_scan_blocked_zip_bundler_runs_once(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    _isolate_plugin_local: Path,
) -> None:
    _repo(tmp_path, monkeypatch)
    plugins.reset_bundles()
    local = paths.plugin_local_dir(create=True)
    pack_id = "pack-boundary-json-escape"
    zip_path = local / f"{pack_id}.zip"
    zip_path.write_bytes(_zip_tree(_pack_fixture("json-escape")))
    before = plugins.bundle_invocations()
    results = []
    for _ in range(3):
        plugins.reset_scan_memo()
        results.append(plugins.scan())
    assert plugins.bundle_invocations() - before == 1
    for result in results:
        assert pack_id not in {p["id"] for p in result["plugins"]}
        blocked = [e for e in result["errors"] if e.get("error") == "pack_boundary"]
        assert blocked
        assert "was blocked" in blocked[0].get("message", "")


def test_upgrade_blocked_message_copy() -> None:
    msg = format_upgrade_blocked_message(
        PackBundleBoundary(
            pack_id="upgrade-probe",
            pack_name="Upgrade probe v2 bad",
            file="frontend/index.ts",
            import_spec="../../../web/src/plugins/host",
        ),
        old_version=2,
    )
    assert msg == (
        "Upgrade probe v2 bad was blocked because it loads code from outside its own folder. "
        "Nothing was updated, so version 2 is still installed. "
        "If you made this pack, run pack lint to see what to fix."
    )
    assert "frontend/index.ts" not in msg
    unknown = format_upgrade_blocked_message(PackBundleBoundary(pack_id="p", pack_name="P", file="", import_spec=""), None)
    assert unknown == (
        "P was blocked because it loads code from outside its own folder. "
        "Nothing was updated, so the version you had is still installed. "
        "If you made this pack, run pack lint to see what to fix."
    )
