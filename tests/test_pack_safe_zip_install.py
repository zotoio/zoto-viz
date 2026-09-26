from __future__ import annotations

import base64
import hashlib
import io
import json
import zipfile
from pathlib import Path

import pytest

from service import mcp as plugin_mcp
from service import pack_safe_zip as psz
from service import paths
from service import plugin_install as pi
from service import plugin_local
from service import plugin_zip as pz
from service.pack_install_copy import REASON_ZIP_UNSAFE
from service.pack_safe_zip import MANIFEST_MEMBER_MAX_BYTES, PackZipRead, read_pack_zip

MINIMAL = "id: sample\nname: Sample\nversion: 1\n"
VIZ = "engine: graph\nbase: topology\n"

PEDANT_PLUGIN_YML = MINIMAL
PEDANT_VIZ = VIZ
PEDANT_ARCHIVE_BYTES_READ = 312
PEDANT_CENTRAL_DIRECTORY_PARSES = 1


def _zip_bytes(files: dict[str, bytes | str]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        for name, body in files.items():
            data = body.encode("utf-8") if isinstance(body, str) else body
            zf.writestr(name, data)
    return buf.getvalue()


def _repo(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    repo = tmp_path / "checkout"
    (repo / "plugins" / "src").mkdir(parents=True)
    (repo / "plugins" / ".runtime").mkdir(parents=True)
    monkeypatch.setenv("ZOTO_VIZ_REPO_ROOT", str(repo))


def _local() -> Path:
    return paths.plugin_local_dir(create=True)


@pytest.fixture(autouse=True)
def _reset() -> None:
    pi.reset_install_pipeline_for_tests()
    plugin_local.reset_watch_for_tests()
    from service.pack_install_blocked_store import reset_blocked_store_for_tests
    from service.pack_install_wall_notices import reset_wall_notices_for_tests

    reset_blocked_store_for_tests()
    reset_wall_notices_for_tests()


def _duplicate_name_zip() -> bytes:
    return _zip_bytes(
        {
            "plugin.yml": MINIMAL,
            "visualisation.yml": VIZ,
            "./plugin.yml": "id: dupe\nname: Dupe\nversion: 1\n",
        },
    )


def _pedant_zip() -> bytes:
    return _zip_bytes({"plugin.yml": PEDANT_PLUGIN_YML, "visualisation.yml": PEDANT_VIZ})


def _plugin_yml_exact_bytes(total: int) -> str:
    prefix = "id: cap\nname: Cap\nversion: 1\npad: "
    if total < len(prefix) + 1:
        raise ValueError("total too small")
    pad_len = total - len(prefix) - 1
    return prefix + ("x" * pad_len) + "\n"


def test_qe_duplicate_name_rejected_before_staging(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    _repo(tmp_path, monkeypatch)
    good = _zip_bytes({"plugin.yml": MINIMAL, "visualisation.yml": VIZ})
    first = plugin_local.publish_local({"zip_b64": base64.b64encode(good).decode()})
    assert first["ok"] is True
    dest = paths.plugin_local_dir() / "sample.zip"
    runtime = paths.plugin_local_runtime_dir() / "sample"
    old_zip = dest.read_bytes()
    old_hash = pi.runtime_tree_hash(runtime)

    bad = _duplicate_name_zip()
    blocked = plugin_local.publish_local(
        {"zip_b64": base64.b64encode(bad).decode(), "overwrite": True},
    )
    assert blocked["ok"] is False
    assert blocked["error"] == REASON_ZIP_UNSAFE
    assert blocked["message"].count("was blocked.") == 1
    assert "duplicate name" in blocked["message"]
    assert dest.read_bytes() == old_zip
    assert pi.runtime_tree_hash(runtime) == old_hash
    assert not pi.list_staging_dirs(paths.plugin_local_runtime_dir())


def test_qe_staged_bytes_match_and_outside_staging_untouched(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    _repo(tmp_path, monkeypatch)
    good = _zip_bytes({"plugin.yml": MINIMAL, "visualisation.yml": VIZ})
    zip_path = tmp_path / "in.zip"
    zip_path.write_bytes(good)
    read = read_pack_zip(zip_path)
    dest = paths.plugin_local_dir(create=True) / "sample.zip"
    runtime = paths.plugin_local_runtime_dir(create=True) / "sample"
    probe = runtime.parent / "outside-staging.probe"
    probe.write_bytes(b"untouched")
    before_probe = probe.read_bytes()

    result = pi.install_zip_to_runtime(
        zip_path,
        dest,
        runtime,
        read.plugin,
        rel=str(dest),
        sha256=pz.plugin_sha256(zip_path),
        pack_read=read,
    )
    assert result["ok"] is True
    assert pi.list_staging_dirs(runtime.parent) == []
    for rel, digest in read.member_sha256.items():
        on_disk = runtime / rel
        assert hashlib.sha256(on_disk.read_bytes()).hexdigest() == digest
    assert probe.read_bytes() == before_probe

    bad_path = tmp_path / "bad.zip"
    bad_path.write_bytes(_zip_bytes({"plugin.yml": MINIMAL, "../escape.yml": b"x\n"}))
    blocked = pi.install_zip_to_runtime(
        bad_path,
        dest,
        runtime,
        read.plugin,
        rel=str(dest),
        sha256=pz.plugin_sha256(bad_path),
    )
    assert blocked["ok"] is False
    assert "zip entry" in blocked["message"]


def test_qe_size_cap_uses_inflated_bytes_exact(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setattr(pz, "MAX_UNCOMPRESSED_BYTES", 50)
    plugin_len = len(MINIMAL.encode("utf-8"))
    remaining = 50 - plugin_len
    payload = b"a" * (remaining + 1)
    z = _zip_bytes({"plugin.yml": MINIMAL, "payload.txt": payload})
    path = tmp_path / "big.zip"
    path.write_bytes(z)
    with pytest.raises(ValueError) as exc:
        read_pack_zip(path)
    assert str(exc.value) == f"zip entry 'payload.txt': uncompressed size exceeds {remaining}"


def test_pa_manifest_read_cap_65536_exact(tmp_path: Path) -> None:
    assert MANIFEST_MEMBER_MAX_BYTES == 65_536
    ok_body = _plugin_yml_exact_bytes(65_536)
    assert len(ok_body.encode("utf-8")) == 65_536
    ok_path = tmp_path / "ok.zip"
    ok_path.write_bytes(_zip_bytes({"plugin.yml": ok_body, "visualisation.yml": VIZ}))
    read_pack_zip(ok_path)

    bad_body = _plugin_yml_exact_bytes(65_537)
    assert len(bad_body.encode("utf-8")) == 65_537
    bad_path = tmp_path / "bad.zip"
    bad_path.write_bytes(_zip_bytes({"plugin.yml": bad_body}))
    with pytest.raises(ValueError) as exc:
        read_pack_zip(bad_path)
    assert "zip entry 'plugin.yml'" in str(exc.value)
    assert "65536 byte manifest read cap" in str(exc.value)


def test_pedant_exact_zip_read_and_single_cd_parse(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    _repo(tmp_path, monkeypatch)
    fixture = tmp_path / "pedant.zip"
    fixture.write_bytes(_pedant_zip())
    calls = 0
    real_read = psz.read_pack_zip

    def counting_read(path: Path) -> PackZipRead:
        nonlocal calls
        calls += 1
        return real_read(path)

    monkeypatch.setattr(psz, "read_pack_zip", counting_read)
    dest = paths.plugin_local_dir(create=True) / "sample.zip"
    runtime = paths.plugin_local_runtime_dir(create=True) / "sample"
    read = real_read(fixture)
    result = pi.install_zip_to_runtime(
        fixture,
        dest,
        runtime,
        read.plugin,
        rel=str(dest),
        sha256=pz.plugin_sha256(fixture),
        upgrade=False,
    )
    assert result["ok"] is True
    assert calls == 1
    last = pi.last_install_pack_read_for_tests()
    assert last is not None
    assert last.stats.archive_bytes_read == PEDANT_ARCHIVE_BYTES_READ
    assert last.stats.central_directory_parses == PEDANT_CENTRAL_DIRECTORY_PARSES


def test_ux_zip_error_names_file_all_entry_points(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    _repo(tmp_path, monkeypatch)
    local = _local()
    bad = _duplicate_name_zip()
    b64 = base64.b64encode(bad).decode()
    web = plugin_local.publish_local({"zip_b64": b64})
    drop = local / "drop.zip"
    drop.write_bytes(bad)
    scan = plugin_local.adopt_local_zip_file(drop, activate=True)
    mcp = plugin_mcp.call_tool("install_plugin_zip", {"zip_b64": b64, "force": True})
    mcp_payload = json.loads(mcp["content"][0]["text"])
    assert web.get("ok") is False
    assert "./plugin.yml" in web.get("message") or "plugin.yml" in web.get("message")
    assert scan.get("message") == web.get("message")
    assert mcp_payload.get("message") == web.get("message")
    for label, payload in (("web", web), ("scan", scan), ("mcp", mcp_payload)):
        assert payload.get("message", "").count("was blocked.") == 1, label
