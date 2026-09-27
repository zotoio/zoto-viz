from __future__ import annotations

import io
import zipfile
from pathlib import Path

import pytest

from service import paths
from service import pack_safe_zip as psz
from service import plugin_local
from service import plugins
from service.pack_id import (
    case_insensitive_pack_id_collision,
    pack_block_path,
    refuse_case_insensitive_id_collision,
)
from service.pack_zip_blocks import record_zip_block, reset_zip_blocks_for_tests, zip_block_for_pack


def _yaml_id(plugin_id: str) -> str:
    if any(c in plugin_id for c in '/:#[]{}') or plugin_id.startswith("."):
        return f'id: "{plugin_id}"\n'
    return f"id: {plugin_id}\n"


def _minimal_zip(plugin_id: str) -> bytes:
    yml = _yaml_id(plugin_id) + "name: Probe\nversion: 1\n"
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("plugin.yml", yml)
    return buf.getvalue()


def _repo(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    repo = tmp_path / "checkout"
    (repo / "plugins" / "src").mkdir(parents=True)
    (repo / "plugins" / ".runtime").mkdir(parents=True)
    monkeypatch.setenv("ZOTO_VIZ_REPO_ROOT", str(repo))
    return repo


def _json_outside_blocks(local: Path) -> list[Path]:
    blocks = (local / "blocks").resolve()
    stray: list[Path] = []
    if not local.is_dir():
        return stray
    for path in local.rglob("*.json"):
        resolved = path.resolve()
        if ".staging" in resolved.parts:
            continue
        if blocks not in resolved.parents and resolved.parent != blocks:
            stray.append(path)
    return stray


def _seed_keep_pack_block() -> tuple[Path, str]:
    digest = "c" * 64
    record_zip_block(
        digest,
        {
            "id": "keep-pack",
            "error": "pack_boundary",
            "message": "static check failed",
            "name": "Keep",
            "zip": "/tmp/keep.zip",
            "sha256": digest,
            "retryable": "true",
        },
    )
    path = pack_block_path("keep-pack")
    return path, path.read_text(encoding="utf-8")


def test_malicious_plugin_ids_refuse_install_without_touching_block_store(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    _isolate_plugin_local: Path,
) -> None:
    _repo(tmp_path, monkeypatch)
    for malicious_id in ("../x", "a/b", "x.json"):
        reset_zip_blocks_for_tests()
        keep_path, keep_body = _seed_keep_pack_block()
        local = paths.plugin_local_dir(create=True)

        out = plugin_local.install_local_zip(_minimal_zip(malicious_id), overwrite=True)
        assert out.get("ok") is False
        assert out.get("error") == "pack_schema_invalid"

        with pytest.raises(ValueError):
            pack_block_path(malicious_id)

        assert keep_path.read_text(encoding="utf-8") == keep_body
        assert _json_outside_blocks(local) == []
        assert not (local / f"{malicious_id}.zip").exists()
        assert list((local / "blocks").glob("*.json")) == [keep_path]
        assert psz.list_staging_dirs(paths.plugin_local_runtime_dir()) == []


def test_install_koi_refused_while_koi_block_record_stays(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    _isolate_plugin_local: Path,
) -> None:
    _repo(tmp_path, monkeypatch)
    reset_zip_blocks_for_tests()
    digest = "b" * 64
    record_zip_block(
        digest,
        {
            "id": "koi",
            "error": "pack_install_start_failed",
            "blockReason": "couldnt_start",
            "message": "koi v2 couldn't start",
            "name": "Koi",
            "zip": "/tmp/koi.zip",
            "sha256": digest,
            "retryable": "true",
        },
    )
    koi_path = pack_block_path("koi")
    before = koi_path.read_text(encoding="utf-8")

    with pytest.raises(ValueError, match="conflicts"):
        refuse_case_insensitive_id_collision("Koi")

    def fake_validate(doc: dict) -> dict:
        return dict(doc)

    monkeypatch.setattr(plugins, "validate_doc", fake_validate)
    out = plugin_local.install_local_zip(_minimal_zip("Koi"), overwrite=True)
    assert out.get("ok") is False
    assert "conflicts" in str(out.get("message") or "")

    assert koi_path.read_text(encoding="utf-8") == before
    row = zip_block_for_pack("koi")
    assert row is not None
    assert row.get("sha256") == digest
    assert case_insensitive_pack_id_collision("Koi") == "koi"
