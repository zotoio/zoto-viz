from __future__ import annotations

import stat
import time
import zipfile
from pathlib import Path

import pytest
import yaml

from service import plugin_zip as pz


MINIMAL = "id: sample\nname: Sample\nversion: 1\n"


def _write_zip(path: Path, files: dict[str, str | bytes]) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(path, "w") as zf:
        for name, body in files.items():
            data = body.encode("utf-8") if isinstance(body, str) else body
            zf.writestr(name, data)
    return path


def _src(tree: Path, extra: dict[str, str] | None = None) -> Path:
    tree.mkdir(parents=True, exist_ok=True)
    (tree / "plugin.yml").write_text(MINIMAL, encoding="utf-8")
    for name, body in (extra or {}).items():
        dest = tree / name
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(body, encoding="utf-8")
    return tree


def test_constants_match_schema_zip_contract() -> None:
    assert pz.MAX_ZIP_BYTES == 1_500_000
    assert pz.MAX_UNCOMPRESSED_BYTES == 4_194_304
    assert pz.MAX_FILES == 80
    assert ".glsl" in pz.ALLOWED_SUFFIX
    assert ".yml" in pz.ALLOWED_SUFFIX


def test_inspect_zip_success(tmp_path: Path) -> None:
    zpath = _write_zip(
        tmp_path / "sample.zip",
        {
            "plugin.yml": MINIMAL,
            "visualisation.yml": "engine: graph\n",
            "frontend/index.ts": "export {}\n",
            "sky/fragment.glsl": "void main() {}\n",
        },
    )
    manifest = pz.inspect_zip(zpath)
    assert manifest.plugin["id"] == "sample"
    assert "plugin.yml" in manifest.members
    assert "visualisation" in manifest.parts
    assert "frontend" in manifest.parts
    assert "sky" in manifest.parts


def test_inspect_rejects_parent_segment(tmp_path: Path) -> None:
    zpath = tmp_path / "bad.zip"
    with zipfile.ZipFile(zpath, "w") as zf:
        zf.writestr("plugin.yml", MINIMAL)
        zf.writestr("../evil.yml", "id: x\n")
    with pytest.raises(ValueError, match="illegal zip path"):
        pz.inspect_zip(zpath)


def test_inspect_rejects_absolute_path(tmp_path: Path) -> None:
    zpath = tmp_path / "abs.zip"
    with zipfile.ZipFile(zpath, "w") as zf:
        zf.writestr("plugin.yml", MINIMAL)
        info = zipfile.ZipInfo("/tmp/x.yml")
        zf.writestr(info, "nope\n")
    with pytest.raises(ValueError, match="absolute zip path"):
        pz.inspect_zip(zpath)


def test_inspect_rejects_disallowed_suffix(tmp_path: Path) -> None:
    zpath = _write_zip(tmp_path / "exe.zip", {"plugin.yml": MINIMAL, "payload.exe": b"MZ"})
    with pytest.raises(ValueError, match="disallowed path"):
        pz.inspect_zip(zpath)


def test_inspect_rejects_symlink(tmp_path: Path) -> None:
    zpath = tmp_path / "link.zip"
    with zipfile.ZipFile(zpath, "w") as zf:
        zf.writestr("plugin.yml", MINIMAL)
        info = zipfile.ZipInfo("alias.yml")
        info.create_system = 3
        info.external_attr = (stat.S_IFLNK | 0o777) << 16
        zf.writestr(info, "plugin.yml")
    with pytest.raises(ValueError, match="symlink"):
        pz.inspect_zip(zpath)


def test_inspect_rejects_oversize(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    zpath = _write_zip(tmp_path / "big.zip", {"plugin.yml": MINIMAL})
    monkeypatch.setattr(pz, "MAX_ZIP_BYTES", 1)
    with pytest.raises(ValueError, match="exceeds"):
        pz.inspect_zip(zpath)


def test_inspect_rejects_too_many_files(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    files = {"plugin.yml": MINIMAL, "a.md": "a\n", "b.md": "b\n"}
    zpath = _write_zip(tmp_path / "many.zip", files)
    monkeypatch.setattr(pz, "MAX_FILES", 2)
    with pytest.raises(ValueError, match="more than"):
        pz.inspect_zip(zpath)


def test_inspect_requires_plugin_yml(tmp_path: Path) -> None:
    zpath = _write_zip(tmp_path / "empty.zip", {"readme.md": "hi\n"})
    with pytest.raises(ValueError, match="plugin.yml"):
        pz.inspect_zip(zpath)


def test_unpack_idempotent_then_refresh(tmp_path: Path) -> None:
    zpath = _write_zip(tmp_path / "sample.zip", {"plugin.yml": MINIMAL})
    dest = tmp_path / "runtime" / "sample"
    first = pz.unpack_zip(zpath, dest)
    assert first.unpacked is True
    assert (dest / "plugin.yml").is_file()
    assert (dest / pz.SHA256_NAME).read_text(encoding="utf-8").strip() == first.sha256
    mtime = (dest / "plugin.yml").stat().st_mtime_ns
    marker_mtime = (dest / pz.SHA256_NAME).stat().st_mtime_ns
    time.sleep(0.02)
    second = pz.unpack_zip(zpath, dest)
    assert second.unpacked is False
    assert second.sha256 == first.sha256
    assert (dest / "plugin.yml").stat().st_mtime_ns == mtime
    assert (dest / pz.SHA256_NAME).stat().st_mtime_ns == marker_mtime

    _write_zip(zpath, {"plugin.yml": "id: sample\nname: Sample\nversion: 2\n"})
    third = pz.unpack_zip(zpath, dest)
    assert third.unpacked is True
    assert third.sha256 != first.sha256
    assert yaml.safe_load((dest / "plugin.yml").read_text(encoding="utf-8"))["version"] == 2


def test_pack_is_byte_identical(tmp_path: Path) -> None:
    src = _src(
        tmp_path / "src" / "sample",
        {"visualisation.yml": "engine: graph\n", "frontend/index.ts": "export {}\n"},
    )
    a = tmp_path / "a.zip"
    b = tmp_path / "b.zip"
    digest_a = pz.pack_tree(src, a)
    digest_b = pz.pack_tree(src, b)
    assert digest_a == digest_b
    assert a.read_bytes() == b.read_bytes()
    with zipfile.ZipFile(a) as zf:
        for info in zf.infolist():
            assert info.date_time == pz.PACK_DATE
            assert info.compress_type == zipfile.ZIP_DEFLATED


def test_inspect_src_and_sha256(tmp_path: Path) -> None:
    src = _src(tmp_path / "sample", {"backend/service.py": "def setup(host):\n    pass\n"})
    manifest = pz.inspect_src(src)
    assert manifest.plugin["id"] == "sample"
    assert "backend" in manifest.parts
    zpath = tmp_path / "sample.zip"
    digest = pz.pack_tree(src, zpath)
    assert pz.plugin_sha256(zpath) == digest
