from __future__ import annotations

import base64
import dataclasses
import hashlib
import io
import json
import logging
import re
import shutil
import struct
import zipfile
from pathlib import Path

import pytest

from service import mcp as plugin_mcp
from service import pack_safe_zip as psz
from service import paths
from service import plugin_install as pi
from service import plugin_local
from service import plugin_zip as pz
from service.pack_install_blocked_store import pack_info_blocked_line, reset_blocked_store_for_tests
from service.pack_install_copy import REASON_ZIP_UNSAFE, upgrade_rollback_user_message, zip_rejection_log_message
from service.pack_install_wall_notices import reset_wall_notices_for_tests

MINIMAL = "id: sample\nname: Sample\nversion: 1\n"
VIZ = "engine: graph\nbase: topology\n"

PEDANT_PLUGIN_YML = MINIMAL
PEDANT_VIZ = VIZ
PEDANT_ARCHIVE_BYTES_READ = 312
PEDANT_CENTRAL_DIRECTORY_PARSES = 1

ZIP_NAME_SAMPLE = "sample"
DUPLICATE_TECHNICAL = (
    "zip entry './plugin.yml': duplicate name (same as 'plugin.yml' after normalization)"
)
DUPLICATE_USER_MSG = (
    "Couldn't install sample.zip. The file isn't a valid pack or is damaged., so version 1 is still installed."
)
DUPLICATE_LOG = (
    "pack zip install rejected: zip entry './plugin.yml': duplicate name "
    "(same as 'plugin.yml' after normalization)"
)
CORRUPT_UNSAFE_USER_MSG = (
    "Couldn't install unsafe.zip. The file isn't a valid pack or is damaged."
)
ENCRYPTED_UNSAFE_USER_MSG = (
    "Couldn't install unsafe.zip. It's password-protected. Zip it again without a password."
)


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
    reset_blocked_store_for_tests()
    reset_wall_notices_for_tests()


@pytest.fixture
def cd_parse_counter(monkeypatch: pytest.MonkeyPatch) -> list[int]:
    ticks: list[int] = []
    real = zipfile.ZipFile._RealGetContents

    def wrapped(self: zipfile.ZipFile) -> None:
        ticks.append(1)
        return real(self)

    monkeypatch.setattr(zipfile.ZipFile, "_RealGetContents", wrapped)
    return ticks


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


def _read_pack_err(path: Path) -> str | None:
    try:
        psz.read_pack_zip(path)
        return None
    except ValueError as exc:
        return str(exc)


def _assert_one_cd_parse(ticks: list[int], fn) -> None:
    before = len(ticks)
    fn()
    assert len(ticks) - before == 1


def test_qe_duplicate_name_rejected_before_staging(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _repo(tmp_path, monkeypatch)
    staging_writes: list[int] = []
    real_write = psz.write_pack_zip_to_staging

    def spy(*args, **kwargs) -> None:
        staging_writes.append(1)
        return real_write(*args, **kwargs)

    monkeypatch.setattr(psz, "write_pack_zip_to_staging", spy)
    good = _zip_bytes({"plugin.yml": MINIMAL, "visualisation.yml": VIZ})
    first = plugin_local.publish_local({"zip_b64": base64.b64encode(good).decode()})
    assert first["ok"] is True
    staging_writes.clear()
    dest = paths.plugin_local_dir() / "sample.zip"
    runtime = paths.plugin_local_runtime_dir() / "sample"
    old_zip = dest.read_bytes()
    old_hash = pi.runtime_tree_hash(runtime)

    bad = _duplicate_name_zip()
    blocked = plugin_local.publish_local(
        {
            "zip_b64": base64.b64encode(bad).decode(),
            "overwrite": True,
            "zip_name": ZIP_NAME_SAMPLE,
        },
    )
    assert blocked["ok"] is False
    assert blocked["error"] == REASON_ZIP_UNSAFE
    assert blocked["message"] == DUPLICATE_USER_MSG
    assert dest.read_bytes() == old_zip
    assert pi.runtime_tree_hash(runtime) == old_hash
    assert staging_writes == []


def test_qe_staged_bytes_match_and_outside_staging_untouched(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _repo(tmp_path, monkeypatch)
    good = _zip_bytes({"plugin.yml": MINIMAL, "visualisation.yml": VIZ})
    zip_path = tmp_path / "in.zip"
    zip_path.write_bytes(good)
    read = psz.read_pack_zip(zip_path)
    dest = paths.plugin_local_dir(create=True) / "sample.zip"
    runtime = paths.plugin_local_runtime_dir(create=True) / "sample"
    parent = runtime.parent
    probe = parent / "outside-staging.probe"
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
    assert result.dest == runtime
    assert pi.list_staging_dirs(parent) == []
    for rel, digest in read.member_sha256.items():
        on_disk = runtime / rel
        assert hashlib.sha256(on_disk.read_bytes()).hexdigest() == digest
    assert probe.read_bytes() == before_probe

    bad_path = tmp_path / "bad.zip"
    bad_path.write_bytes(_zip_bytes({"plugin.yml": MINIMAL, "../escape.yml": b"x\n"}))
    with pytest.raises(ValueError, match="zip entry"):
        pi.install_zip_to_runtime(
            bad_path,
            dest,
            runtime,
            read.plugin,
            rel=str(dest),
            sha256=pz.plugin_sha256(bad_path),
            upgrade=True,
        )


def test_qe_size_cap_uses_inflated_bytes_exact(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setattr(pz, "MAX_UNCOMPRESSED_BYTES", 50)
    plugin_len = len(MINIMAL.encode("utf-8"))
    remaining = 50 - plugin_len
    payload = b"a" * (remaining + 1)
    z = _zip_bytes({"plugin.yml": MINIMAL, "payload.txt": payload})
    path = tmp_path / "big.zip"
    path.write_bytes(z)
    with pytest.raises(ValueError) as exc:
        psz.read_pack_zip(path)
    assert str(exc.value) == f"zip entry 'payload.txt': uncompressed size exceeds {remaining}"


def _patch_cd_uncompressed_size(blob: bytes, member: str, declared: int) -> bytes:
    name = member.encode("utf-8")
    sig = b"PK\x01\x02"
    data = bytearray(blob)
    pos = 0
    while True:
        idx = data.find(sig, pos)
        if idx < 0:
            raise ValueError("central directory header not found")
        name_len = struct.unpack_from("<H", data, idx + 28)[0]
        name_start = idx + 46
        entry_name = bytes(data[name_start : name_start + name_len])
        if entry_name.replace(b"\\", b"/") == name:
            struct.pack_into("<I", data, idx + 24, declared)
            return bytes(data)
        pos = idx + 1
    raise ValueError(f"member {member!r} not in central directory")


def test_qe_cd_declared_size_larger_than_actual(tmp_path: Path) -> None:
    z = _zip_bytes({"plugin.yml": MINIMAL, "visualisation.yml": VIZ})
    patched = _patch_cd_uncompressed_size(z, "visualisation.yml", 10_000)
    path = tmp_path / "lie.zip"
    path.write_bytes(patched)
    with pytest.raises(ValueError) as exc:
        psz.read_pack_zip(path)
    assert str(exc.value) == "zip entry 'visualisation.yml': inflated 29 bytes, declared 10000"


def test_pa_manifest_read_cap_65536_exact(tmp_path: Path) -> None:
    assert psz.MANIFEST_MEMBER_MAX_BYTES == 65_536
    ok_body = _plugin_yml_exact_bytes(65_536)
    assert len(ok_body.encode("utf-8")) == 65_536
    ok_path = tmp_path / "ok.zip"
    ok_path.write_bytes(_zip_bytes({"plugin.yml": ok_body, "visualisation.yml": VIZ}))
    assert _read_pack_err(ok_path) is None
    read = psz.read_pack_zip(ok_path)
    assert len(read.members["plugin.yml"]) == 65_536

    bad_body = _plugin_yml_exact_bytes(65_537)
    assert len(bad_body.encode("utf-8")) == 65_537
    bad_path = tmp_path / "bad.zip"
    bad_path.write_bytes(_zip_bytes({"plugin.yml": bad_body}))
    assert _read_pack_err(bad_path) == (
        "zip entry 'plugin.yml': exceeds 65536 byte manifest read cap"
    )


def test_pa_manifest_stream_stops_at_65537_bytes_read(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    reads: list[int] = []
    real_read = psz._read_member_bytes

    def counting(zf, info, cap):  # type: ignore[no-untyped-def]
        out = real_read(zf, info, cap)
        reads.append(len(out))
        return out

    monkeypatch.setattr(psz, "_read_member_bytes", counting)
    huge = _plugin_yml_exact_bytes(65_537)
    path = tmp_path / "huge.zip"
    path.write_bytes(_zip_bytes({"plugin.yml": huge}))
    with pytest.raises(ValueError):
        psz.read_pack_zip(path)
    assert reads == [65_537]


def test_pedant_single_cd_parse_web_adopt_mcp(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    cd_parse_counter: list[int],
) -> None:
    _repo(tmp_path, monkeypatch)
    fixture = _pedant_zip()
    b64 = base64.b64encode(fixture).decode()

    def web() -> None:
        out = plugin_local.publish_local({"zip_b64": b64})
        assert out["ok"] is True

    _assert_one_cd_parse(cd_parse_counter, web)
    last = pi.last_install_pack_read_for_tests()
    assert last is not None
    assert last.stats.archive_bytes_read == PEDANT_ARCHIVE_BYTES_READ
    assert last.stats.central_directory_parses == PEDANT_CENTRAL_DIRECTORY_PARSES

    drop = _local() / "pedant-drop.zip"
    drop.write_bytes(fixture)

    def adopt() -> None:
        out = plugin_local.adopt_local_zip_file(drop, activate=False)
        assert out["ok"] is True

    _assert_one_cd_parse(cd_parse_counter, adopt)

    def mcp() -> None:
        raw = plugin_mcp.call_tool("install_plugin_zip", {"zip_b64": b64, "force": True})
        payload = json.loads(raw["content"][0]["text"])
        assert payload["ok"] is True

    _assert_one_cd_parse(cd_parse_counter, mcp)


def test_pedant_single_cd_parse_remint_path(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    cd_parse_counter: list[int],
) -> None:
    _repo(tmp_path, monkeypatch)
    first = _zip_bytes({"plugin.yml": MINIMAL, "visualisation.yml": VIZ})
    assert plugin_local.publish_local({"zip_b64": base64.b64encode(first).decode()})["ok"] is True
    second = _zip_bytes(
        {
            "plugin.yml": MINIMAL,
            "visualisation.yml": "engine: graph\nbase: topology\nextra: 1\n",
        },
    )

    def remint_install() -> None:
        out = plugin_local.publish_local({"zip_b64": base64.b64encode(second).decode()})
        assert out["ok"] is True
        assert out.get("remintedFrom") == "sample"
        assert out["id"] == "sample-2"

    _assert_one_cd_parse(cd_parse_counter, remint_install)


def test_ux_zip_error_names_file_all_entry_points(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    caplog.set_level(logging.INFO)
    _repo(tmp_path, monkeypatch)
    local = _local()
    good = _zip_bytes({"plugin.yml": MINIMAL, "visualisation.yml": VIZ})
    good_b64 = base64.b64encode(good).decode()
    assert plugin_local.publish_local({"zip_b64": good_b64})["ok"] is True
    plugin_mcp.call_tool("install_plugin_zip", {"zip_b64": good_b64, "force": True})
    bad = _duplicate_name_zip()
    b64 = base64.b64encode(bad).decode()
    caplog.clear()
    web = plugin_local.publish_local({"zip_b64": b64, "overwrite": True, "zip_name": ZIP_NAME_SAMPLE})
    caplog.clear()
    drop = local / f"{ZIP_NAME_SAMPLE}.zip"
    drop.write_bytes(bad)
    scan = plugin_local.adopt_local_zip_file(drop, activate=True)
    caplog.clear()
    mcp = plugin_mcp.call_tool(
        "install_plugin_zip",
        {"zip_b64": b64, "force": True, "overwrite": True, "zip_name": ZIP_NAME_SAMPLE},
    )
    mcp_payload = json.loads(mcp["content"][0]["text"])
    for label, payload in (("web", web), ("scan", scan), ("mcp", mcp_payload)):
        assert payload.get("ok") is False, label
        assert payload.get("message") == DUPLICATE_USER_MSG, label
        msg = payload.get("message") or ""
        assert "zip entry" not in msg
        assert "plugin.yml" not in msg
        assert not re.search(r"\b\d{2,}\b", msg.replace("version 1", ""))
    assert DUPLICATE_LOG in caplog.text


def _patch_cd_field(blob: bytes, member: str, *, flag_bits: int | None = None, compress_type: int | None = None) -> bytes:
    name = member.encode("utf-8")
    sig = b"PK\x01\x02"
    data = bytearray(blob)
    pos = 0
    while True:
        idx = data.find(sig, pos)
        if idx < 0:
            raise ValueError("central directory header not found")
        name_len = struct.unpack_from("<H", data, idx + 28)[0]
        name_start = idx + 46
        entry_name = bytes(data[name_start : name_start + name_len])
        if entry_name.replace(b"\\", b"/") == name:
            if flag_bits is not None:
                struct.pack_into("<H", data, idx + 8, flag_bits)
            if compress_type is not None:
                struct.pack_into("<H", data, idx + 10, compress_type)
            return bytes(data)
        pos = idx + 1
    raise ValueError(f"member {member!r} not in central directory")


def _zip_crc_mismatch() -> bytes:
    z = _zip_bytes({"plugin.yml": MINIMAL, "visualisation.yml": VIZ})
    data = bytearray(z)
    marker = b"visualisation.yml"
    start = data.index(marker)
    data[start + len(marker)] ^= 0xFF
    return bytes(data)


def _zip_encrypted_member() -> bytes:
    z = _zip_bytes({"plugin.yml": MINIMAL, "visualisation.yml": VIZ})
    return _patch_cd_field(z, "plugin.yml", flag_bits=0x1)


def _zip_unsupported_compression() -> bytes:
    z = _zip_bytes({"plugin.yml": MINIMAL, "visualisation.yml": VIZ})
    return _patch_cd_field(z, "plugin.yml", compress_type=9)


def _zip_name_mismatch() -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("plugin.yml", MINIMAL)
        zf.writestr("visualisation.yml", VIZ)
    data = bytearray(buf.getvalue())
    data = data.replace(b"visualisation.yml", b"visualisatioX.yml", 1)
    return bytes(data)


def _assert_zip_unsafe_all_entry_points(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    blob: bytes,
    *,
    user_message: str,
    log_technical: str,
    zip_name: str = "unsafe",
) -> None:
    caplog.set_level(logging.INFO)
    _repo(tmp_path, monkeypatch)
    b64 = base64.b64encode(blob).decode()
    caplog.clear()
    web = plugin_local.publish_local({"zip_b64": b64, "zip_name": zip_name})
    drop = _local() / f"{zip_name}.zip"
    drop.write_bytes(blob)
    caplog.clear()
    scan = plugin_local.adopt_local_zip_file(drop, activate=True)
    caplog.clear()
    mcp = plugin_mcp.call_tool(
        "install_plugin_zip",
        {"zip_b64": b64, "force": True, "zip_name": zip_name},
    )
    mcp_payload = json.loads(mcp["content"][0]["text"])
    for label, payload in (("web", web), ("scan", scan), ("mcp", mcp_payload)):
        assert payload.get("ok") is False, label
        assert payload.get("error") == REASON_ZIP_UNSAFE, label
        assert payload.get("message") == user_message, label
        msg = payload.get("message") or ""
        assert "BadZipFile" not in msg and "ValueError" not in msg
        assert "zip entry" not in msg
    assert zip_rejection_log_message(log_technical) in caplog.text


def test_zip_crc_mismatch_all_entry_points(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    technical = "zip entry 'visualisation.yml': Bad CRC-32 for file 'visualisation.yml'"
    _assert_zip_unsafe_all_entry_points(
        tmp_path,
        monkeypatch,
        caplog,
        _zip_crc_mismatch(),
        user_message=CORRUPT_UNSAFE_USER_MSG,
        log_technical=technical,
    )


def test_zip_encrypted_all_entry_points(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    technical = "zip entry 'plugin.yml': encrypted entries are not allowed"
    _assert_zip_unsafe_all_entry_points(
        tmp_path,
        monkeypatch,
        caplog,
        _zip_encrypted_member(),
        user_message=ENCRYPTED_UNSAFE_USER_MSG,
        log_technical=technical,
    )


def test_zip_unsupported_compression_all_entry_points(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    technical = "zip entry 'plugin.yml': unsupported compression method"
    _assert_zip_unsafe_all_entry_points(
        tmp_path,
        monkeypatch,
        caplog,
        _zip_unsupported_compression(),
        user_message=CORRUPT_UNSAFE_USER_MSG,
        log_technical=technical,
    )


def test_zip_name_mismatch_all_entry_points(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    technical = (
        "zip entry 'visualisation.yml': "
        "File name in directory 'visualisation.yml' and header b'visualisatioX.yml' differ."
    )
    _assert_zip_unsafe_all_entry_points(
        tmp_path,
        monkeypatch,
        caplog,
        _zip_name_mismatch(),
        user_message=CORRUPT_UNSAFE_USER_MSG,
        log_technical=technical,
    )


def test_zip_ratio_limit_rejects_23mb_zeros(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(pz, "MAX_ZIP_BYTES", 30_000_000)
    payload = b"\x00" * 23_000_000
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("plugin.yml", MINIMAL)
        zf.writestr("visualisation.yml", VIZ)
        zf.writestr("zeros.txt", payload)
    z = buf.getvalue()
    path = tmp_path / "zeros.zip"
    path.write_bytes(z)
    with pytest.raises(ValueError) as exc:
        psz.read_pack_zip(path)
    assert "compression ratio exceeds" in str(exc.value)


def test_zip_entry_cap_counts_directory_entries(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(pz, "MAX_FILES", 25_000)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("plugin.yml", MINIMAL)
        zf.writestr("visualisation.yml", VIZ)
        for i in range(24_999):
            zf.mkdir(f"d{i}")
    path = tmp_path / "dirs.zip"
    path.write_bytes(buf.getvalue())
    with pytest.raises(ValueError) as exc:
        psz.read_pack_zip(path)
    assert str(exc.value) == "zip has more than 25000 entries"


def test_staged_pack_cannot_be_constructed_outside_validator() -> None:
    with pytest.raises(TypeError, match="StagedPack cannot be constructed"):
        psz.StagedPack(
            staging_dir=Path("/tmp/x"),
            zip_sha256="0",
            tree_sha256="0",
            manifest={"id": "x", "name": "X", "version": 1},
            source="test",
            member_sha256={},
            members_sorted=(),
            parts=(),
            stats=psz.ZipReadStats(),
            tree_hash_bytes_read=0,
            _token=object(),
        )


def test_pa_fresh_install_zero_staging_hash_bytes(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    _repo(tmp_path, monkeypatch)
    good = _zip_bytes({"plugin.yml": MINIMAL, "visualisation.yml": VIZ})
    zip_path = tmp_path / "in.zip"
    zip_path.write_bytes(good)
    staged = psz.read_pack_zip(zip_path)
    assert staged.tree_hash_bytes_read == 0
    assert staged.stats.staging_tree_hash_bytes_read == 0
    _, disk_bytes = psz.runtime_tree_hash_from_disk_with_byte_count(staged.staging_dir)
    assert disk_bytes > 0


def test_pa_remint_hashes_only_plugin_yml(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    _repo(tmp_path, monkeypatch)
    good = _zip_bytes({"plugin.yml": MINIMAL, "visualisation.yml": VIZ})
    zip_path = tmp_path / "in.zip"
    zip_path.write_bytes(good)
    staged = psz.read_pack_zip(zip_path)
    reminted = psz.remint(staged, "sample-2")
    yml_len = (reminted.staging_dir / "plugin.yml").read_bytes().__len__()
    assert reminted.tree_hash_bytes_read == yml_len
    assert reminted.stats.staging_tree_hash_bytes_read == yml_len
    _, disk_bytes = psz.runtime_tree_hash_from_disk_with_byte_count(reminted.staging_dir)
    assert disk_bytes > yml_len


def test_pa_remint_tree_matches_from_scratch(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    _repo(tmp_path, monkeypatch)
    good = _zip_bytes({"plugin.yml": MINIMAL, "visualisation.yml": VIZ})
    zip_path = tmp_path / "in.zip"
    zip_path.write_bytes(good)
    staged = psz.read_pack_zip(zip_path)
    reminted = psz.remint(staged, "sample-2")
    assert reminted.tree_sha256 == psz.runtime_tree_hash(reminted.staging_dir)


def test_pa_tree_hash_sensitive_to_path_layout(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    _repo(tmp_path, monkeypatch)
    good = _zip_bytes({"plugin.yml": MINIMAL, "visualisation.yml": VIZ})
    zip_path = tmp_path / "in.zip"
    zip_path.write_bytes(good)
    staged = psz.read_pack_zip(zip_path)
    root = staged.staging_dir
    viz = root / "visualisation.yml"
    data = viz.read_bytes()
    viz.unlink()
    sub = root / "nested"
    sub.mkdir()
    (sub / "visualisation.yml").write_bytes(data)
    before = staged.tree_sha256
    after = psz.runtime_tree_hash(root)
    assert after != before
    moved_digest = hashlib.sha256((sub / "visualisation.yml").read_bytes()).hexdigest()
    assert moved_digest == staged.member_sha256["visualisation.yml"]


def test_qe_upgrade_rollback_restores_v1_and_cleans_bak(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _repo(tmp_path, monkeypatch)
    good = _zip_bytes({"plugin.yml": MINIMAL, "visualisation.yml": VIZ})
    assert plugin_local.publish_local({"zip_b64": base64.b64encode(good).decode()})["ok"] is True
    runtime = paths.plugin_local_runtime_dir() / "sample"
    old_tree = pi.runtime_tree_hash(runtime)
    v2 = _zip_bytes({"plugin.yml": "id: sample\nname: Sample\nversion: 2\n", "visualisation.yml": VIZ})
    expected = upgrade_rollback_user_message("Sample", 2, 1)

    def boom() -> None:
        raise OSError("rename failed")

    pi.set_after_first_rename(boom)
    try:
        blocked = plugin_local.publish_local(
            {"zip_b64": base64.b64encode(v2).decode(), "overwrite": True},
        )
        again = plugin_local.publish_local(
            {"zip_b64": base64.b64encode(v2).decode(), "overwrite": True},
        )
    finally:
        pi.set_after_first_rename(None)
    assert blocked["ok"] is False
    assert again["ok"] is False
    assert blocked["message"] == expected
    assert pack_info_blocked_line("sample") == expected
    assert blocked.get("packInstallBlocked") == expected
    notices = blocked.get("installNotices") or []
    assert len(notices) == 1
    assert notices[0]["message"] == expected
    assert len(again.get("installNotices") or []) == 0
    assert "rename failed" not in str(blocked)
    assert "Traceback" not in str(blocked)
    assert pi.runtime_tree_hash(runtime) == old_tree
    assert pi.list_staging_dirs(runtime.parent) == []

    bak = runtime.parent / "sample.bak"
    bak.mkdir()
    (bak / "marker.txt").write_text("leftover", encoding="utf-8")
    assert runtime.is_dir()
    pi.recover_leftover_bak_dirs(runtime.parent)
    assert not bak.is_dir()


def test_qe_upgrade_succeeds_when_bak_cleanup_fails(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _repo(tmp_path, monkeypatch)
    good = _zip_bytes({"plugin.yml": MINIMAL, "visualisation.yml": VIZ})
    assert plugin_local.publish_local({"zip_b64": base64.b64encode(good).decode()})["ok"] is True
    v2 = _zip_bytes(
        {
            "plugin.yml": "id: sample\nname: Sample\nversion: 2\n",
            "visualisation.yml": VIZ,
        },
    )
    real_rmtree = shutil.rmtree
    bak_path = paths.plugin_local_runtime_dir() / "sample.bak"

    def flaky_rmtree(path, *args, **kwargs):
        if Path(path) == bak_path:
            raise OSError("delete failed")
        return real_rmtree(path, *args, **kwargs)

    monkeypatch.setattr(shutil, "rmtree", flaky_rmtree)
    out = plugin_local.publish_local({"zip_b64": base64.b64encode(v2).decode(), "overwrite": True})
    assert out["ok"] is True
    assert out.get("version") == 2
    assert not (out.get("installNotices") or [])
    assert pack_info_blocked_line("sample") is None
    runtime = paths.plugin_local_runtime_dir() / "sample"
    assert (runtime / "plugin.yml").read_text(encoding="utf-8").startswith("id: sample\nname: Sample\nversion: 2")


def test_qe_crash_staging_removed_at_boot(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    _repo(tmp_path, monkeypatch)
    parent = paths.plugin_local_runtime_dir(create=True)
    orphan = pi.new_staging_dir(parent, "orphan-crash")
    (orphan / "plugin.yml").write_text("id: orphan-crash\nname: O\nversion: 1\n", encoding="utf-8")
    assert len(pi.list_staging_dirs(parent)) == 1
    removed = pi.recover_orphan_staging_dirs(parent)
    assert removed == 1
    assert pi.list_staging_dirs(parent) == []
    ids = {p["id"] for p in __import__("service.plugins", fromlist=["plugins"]).scan()["plugins"]}
    assert "orphan-crash" not in ids


def test_qe_staged_pack_guard_registry(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    _repo(tmp_path, monkeypatch)
    good = _zip_bytes({"plugin.yml": MINIMAL, "visualisation.yml": VIZ})
    zip_path = tmp_path / "in.zip"
    zip_path.write_bytes(good)
    staged = psz.read_pack_zip(zip_path)
    forged = dataclasses.replace(staged, tree_sha256="0" * 64)
    with pytest.raises(ValueError, match="not issued"):
        psz.go_live(forged, tmp_path / "forged-live")
    bare = object.__new__(psz.StagedPack)
    with pytest.raises(TypeError, match="cannot be constructed"):
        psz.go_live(bare, tmp_path / "bare-live")
    psz.go_live(staged, tmp_path / "ok-live")


def test_consent_survives_pack_tree_hash_migration(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    _repo(tmp_path, monkeypatch)
    from service import plugins

    good = _zip_bytes({"plugin.yml": MINIMAL, "visualisation.yml": VIZ})
    assert plugin_local.publish_local({"zip_b64": base64.b64encode(good).decode()})["ok"] is True
    runtime = paths.plugin_local_runtime_dir() / "sample"
    legacy = psz.legacy_runtime_tree_hash(runtime)
    doc = plugins.validate_doc({"id": "sample", "name": "Sample", "version": 1})
    plugins._persist_consent_doc(
        {
            "sample": {
                "kind": "reviewed",
                "stamp": plugins.consent_stamp(doc),
                "version": 1,
                "pack_tree_sha256": legacy,
            },
        },
    )
    msgs = plugins.migrate_consent_pack_tree_hashes(runtime.parent)
    assert any("sample" in m for m in msgs)
    assert plugins.consent_kind(doc) == "reviewed"
    rec = plugins._consent_doc()["sample"]
    assert rec.get("tree_hash_version") == plugins.PACK_TREE_HASH_VERSION
    assert rec.get("pack_tree_sha256") == psz.runtime_tree_hash(runtime)


def test_zip_rejects_drive_relative_name(tmp_path: Path) -> None:
    z = _zip_bytes({"plugin.yml": MINIMAL, "C:evil.yml": b"x\n"})
    path = tmp_path / "drive.zip"
    path.write_bytes(z)
    with pytest.raises(ValueError) as exc:
        psz.read_pack_zip(path)
    assert "zip entry 'C:evil.yml'" in str(exc.value)
