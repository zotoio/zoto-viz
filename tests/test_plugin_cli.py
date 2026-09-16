from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

from service import plugin_zip as pz
from service import plugins
from service import sysconfig


ROOT = Path(__file__).resolve().parents[1]
MINIMAL = "id: sample\nname: Sample\nversion: 1\n"


def _repo(tmp_path: Path) -> Path:
    repo = tmp_path / "checkout"
    (repo / "plugins" / "src").mkdir(parents=True)
    (repo / "plugins" / ".runtime").mkdir(parents=True)
    return repo


def _src(repo: Path, pid: str = "sample", extra: str = "", files: dict[str, str] | None = None) -> Path:
    src = repo / "plugins" / "src" / pid
    src.mkdir(parents=True, exist_ok=True)
    body = f"id: {pid}\nname: {pid}\nversion: 1\n{extra}"
    (src / "plugin.yml").write_text(body, encoding="utf-8")
    for name, text in (files or {}).items():
        dest = src / name
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(text, encoding="utf-8")
    return src


def test_validate_zip_and_src_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys) -> None:
    repo = _repo(tmp_path)
    src = _src(repo, files={"frontend/index.ts": "export {}\n"})
    monkeypatch.setenv("ZOTO_VIZ_REPO_ROOT", str(repo))
    zpath = repo / "plugins" / "sample.zip"
    pz.pack_tree(src, zpath)
    assert plugins.cli_validate([str(zpath)]) == 0
    out = capsys.readouterr().out
    assert "sample" in out
    assert plugins.cli_validate([str(src)]) == 0
    out = capsys.readouterr().out
    assert "sample" in out


def test_pack_add_list_roundtrip(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys) -> None:
    repo = _repo(tmp_path)
    _src(repo, files={"visualisation.yml": "engine: graph\n"})
    monkeypatch.setenv("ZOTO_VIZ_REPO_ROOT", str(repo))
    assert plugins.cli_pack("sample") == 0
    packed = repo / "dist" / "sample.zip"
    assert packed.is_file()
    assert not (repo / "plugins" / "sample.zip").exists()
    out = capsys.readouterr().out
    assert packed.name in out
    digest = pz.plugin_sha256(packed)
    assert digest in out
    scanned = plugins.scan()
    assert not any("sample.zip" in str(e.get("file") or "") for e in scanned.get("errors") or [])

    other = tmp_path / "incoming.zip"
    other.write_bytes(packed.read_bytes())
    shutil.rmtree(repo / "plugins" / "src" / "sample")
    contrib = repo / "plugins" / "sample.zip"
    assert plugins.cli_add(str(other), force=False) == 0
    assert contrib.is_file()
    capsys.readouterr()
    assert plugins.cli_list() == 0
    listed = capsys.readouterr().out
    assert "sample" in listed
    assert "visualisation" in listed
    assert str(contrib) in listed


def test_pack_output_flag(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys) -> None:
    repo = _repo(tmp_path)
    _src(repo)
    monkeypatch.setenv("ZOTO_VIZ_REPO_ROOT", str(repo))
    dest = tmp_path / "x.zip"
    assert plugins.cli_pack("sample", str(dest)) == 0
    assert dest.is_file()
    assert not (repo / "plugins" / "sample.zip").exists()
    assert not (repo / "dist" / "sample.zip").exists()
    out = capsys.readouterr().out
    assert str(dest) in out


def test_pack_output_via_cli(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    repo = _repo(tmp_path)
    _src(repo)
    dest = tmp_path / "shared.zip"
    env = {**os.environ, "ZOTO_VIZ_REPO_ROOT": str(repo)}
    proc = subprocess.run(
        [sys.executable, str(ROOT / "zoto-viz"), "plugin", "pack", "sample", "-o", str(dest)],
        cwd=ROOT,
        capture_output=True,
        text=True,
        env=env,
        check=False,
    )
    assert proc.returncode == 0
    assert dest.is_file()
    assert not (repo / "plugins" / "sample.zip").exists()


def test_add_refuses_overwrite_without_force(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys) -> None:
    repo = _repo(tmp_path)
    src = _src(repo)
    monkeypatch.setenv("ZOTO_VIZ_REPO_ROOT", str(repo))
    dest = repo / "plugins" / "sample.zip"
    pz.pack_tree(src, dest)
    shutil.rmtree(src)
    incoming = tmp_path / "again.zip"
    incoming.write_bytes(dest.read_bytes())
    assert plugins.cli_add(str(incoming), force=False) == 1
    err = capsys.readouterr().err
    assert "refusing to overwrite" in err
    assert plugins.cli_add(str(incoming), force=True) == 0


def test_add_refuses_src_owned_id_even_with_force(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys,
) -> None:
    repo = _repo(tmp_path)
    src = _src(repo)
    monkeypatch.setenv("ZOTO_VIZ_REPO_ROOT", str(repo))
    incoming = tmp_path / "incoming.zip"
    pz.pack_tree(src, incoming)
    assert plugins.cli_add(str(incoming), force=False) == 1
    err = capsys.readouterr().err
    assert "src owns" in err
    assert plugins.cli_add(str(incoming), force=True) == 1
    err = capsys.readouterr().err
    assert "src owns" in err
    assert "--force does not override" in err
    assert not (repo / "plugins" / "sample.zip").exists()


def test_add_refuses_parent_and_absolute_members(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys) -> None:
    import zipfile

    repo = _repo(tmp_path)
    monkeypatch.setenv("ZOTO_VIZ_REPO_ROOT", str(repo))
    bad = tmp_path / "bad.zip"
    with zipfile.ZipFile(bad, "w") as zf:
        zf.writestr("plugin.yml", MINIMAL)
        zf.writestr("../evil.yml", "x\n")
    assert plugins.cli_add(str(bad), force=False) == 1
    assert "illegal zip path" in capsys.readouterr().err
    assert not (repo / "plugins" / "sample.zip").exists()

    abszip = tmp_path / "abs.zip"
    with zipfile.ZipFile(abszip, "w") as zf:
        zf.writestr("plugin.yml", MINIMAL)
        zf.writestr("/tmp/x.yml", "x\n")
    assert plugins.cli_add(str(abszip), force=False) == 1
    assert "absolute zip path" in capsys.readouterr().err


def test_zip_deprecation_alias(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys) -> None:
    repo = _repo(tmp_path)
    src = _src(repo)
    monkeypatch.setenv("ZOTO_VIZ_REPO_ROOT", str(repo))
    incoming = tmp_path / "sample.zip"
    pz.pack_tree(src, incoming)
    shutil.rmtree(src)
    assert plugins.cli_zip_deprecated(str(incoming), force=False) == 0
    out = capsys.readouterr().out
    assert "[deprecation] plugin zip is now plugin add" in out
    assert (repo / "plugins" / "sample.zip").is_file()
    assert plugins.cli_zip_deprecated(str(tmp_path / "missing.zip"), True) == 1


def test_plugin_install_removed() -> None:
    proc = subprocess.run(
        [sys.executable, str(ROOT / "zoto-viz"), "plugin", "install"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    assert proc.returncode != 0
    blob = (proc.stderr or "") + (proc.stdout or "")
    assert "invalid choice" in blob or "unrecognized" in blob


def test_zip_alias_via_subprocess(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    repo = _repo(tmp_path)
    src = _src(repo)
    incoming = tmp_path / "in.zip"
    pz.pack_tree(src, incoming)
    shutil.rmtree(src)
    env = {**os.environ, "ZOTO_VIZ_REPO_ROOT": str(repo)}
    proc = subprocess.run(
        [sys.executable, str(ROOT / "zoto-viz"), "plugin", "zip", str(incoming)],
        cwd=ROOT,
        capture_output=True,
        text=True,
        env=env,
        check=False,
    )
    assert proc.returncode == 0
    assert "[deprecation] plugin zip is now plugin add" in proc.stdout
    assert (repo / "plugins" / "sample.zip").is_file()


def test_top_level_install_writes_systemd(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys) -> None:
    cfg_path = tmp_path / "sys-config.yml"
    dropin = tmp_path / "override.conf"
    monkeypatch.setattr(sysconfig, "sys_config_file", lambda: cfg_path)
    monkeypatch.setattr(
        sysconfig,
        "ensure",
        lambda: {"ssids": ["Home"], "root": str(tmp_path), "hostname": "h", "iface": "wlan0", "monitor_iface": ""},
    )
    monkeypatch.setattr(sysconfig, "write_systemd_override", lambda cfg: dropin)
    dropin.write_text("ok\n", encoding="utf-8")
    assert sysconfig.cli_install() == 0
    out = capsys.readouterr().out
    assert "sys-config" in out
    assert "systemd" in out
