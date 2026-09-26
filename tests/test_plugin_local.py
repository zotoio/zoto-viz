from __future__ import annotations

import io
import json
import zipfile
from pathlib import Path

import pytest

from service import live
from service import mcp as plugin_mcp
from service import paths
from service import plugin_local
from service import plugin_zip as pz
from service import plugins


MINIMAL = "id: local-demo\nname: Local demo\nversion: 1\n"


def _zip(files: dict[str, str | bytes]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        for name, body in files.items():
            data = body.encode("utf-8") if isinstance(body, str) else body
            zf.writestr(name, data)
    return buf.getvalue()


def _repo(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    repo = tmp_path / "checkout"
    (repo / "plugins" / "src").mkdir(parents=True)
    (repo / "plugins" / ".runtime").mkdir(parents=True)
    monkeypatch.setenv("ZOTO_VIZ_REPO_ROOT", str(repo))
    return repo


def test_publish_files_writes_local_and_activates(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, _isolate_plugin_local: Path,
) -> None:
    _repo(tmp_path, monkeypatch)
    live.reset_for_tests()
    info = plugin_local.publish_local({
        "files": {
            "plugin.yml": MINIMAL,
            "visualisation.yml": "engine: graph\nbase: topology\n",
        },
    })
    assert info["ok"] is True
    assert info["id"] == "local-demo"
    assert info["activated"] is True
    assert info["mode"] == "plugin:local-demo"
    dest = paths.plugin_local_dir() / "local-demo.zip"
    assert dest.is_file()
    assert info["path"] == str(dest)
    assert (paths.plugin_local_runtime_dir() / "local-demo" / "plugin.yml").is_file()
    snap = live.snapshot()
    assert snap["patch"]["reloadPlugins"] is True
    assert snap["patch"]["mode"] == "plugin:local-demo"
    row = next(p for p in plugins.scan()["plugins"] if p["id"] == "local-demo")
    assert row["origin"] == "local"
    assert row["zip"] == str(dest)


def test_publish_description_mints_yaml_view(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    _repo(tmp_path, monkeypatch)
    live.reset_for_tests()
    info = plugin_local.publish_local({
        "description": "Show the noisiest talkers as a heat map",
        "name": "Talker heat",
        "base": "talkers",
    })
    assert info["ok"] is True
    assert info["activated"] is True
    assert info["id"] == "talker-heat"
    yml = (paths.plugin_local_runtime_dir() / "talker-heat" / "plugin.yml").read_text(encoding="utf-8")
    viz = (paths.plugin_local_runtime_dir() / "talker-heat" / "visualisation.yml").read_text(encoding="utf-8")
    assert "id: talker-heat" in yml
    assert "engine: graph" in viz
    assert "base: talkers" in viz


def test_publish_description_keeps_explicit_id(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    _repo(tmp_path, monkeypatch)
    first = plugin_local.publish_local({
        "description": "Show the noisiest talkers",
        "id": "tool-probe",
        "name": "Tool probe",
        "base": "talkers",
    })
    assert first["ok"] is True
    assert first["id"] == "tool-probe"
    again = plugin_local.publish_local({
        "description": "Show the noisiest talkers",
        "id": "tool-probe",
        "name": "Tool probe",
        "base": "talkers",
    })
    assert again["ok"] is True
    assert again["id"] == "tool-probe"
    assert again["wrote"] is False
    assert not (paths.plugin_local_dir() / "tool-probe-2.zip").exists()


def test_unique_id_skips_taken(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    repo = _repo(tmp_path, monkeypatch)
    src = repo / "plugins" / "src" / "talker-heat"
    src.mkdir(parents=True)
    (src / "plugin.yml").write_text("id: talker-heat\nname: Heat\nversion: 1\n", encoding="utf-8")
    assert plugin_local.unique_id("Talker heat") == "talker-heat-2"
    assert plugin_local.unique_id("talker-heat-2") == "talker-heat-2"


def test_publish_description_remints_when_id_omitted(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    _repo(tmp_path, monkeypatch)
    first = plugin_local.publish_local({
        "description": "Show the noisiest talkers as a heat map",
        "name": "Talker heat",
        "base": "talkers",
    })
    assert first["id"] == "talker-heat"
    second = plugin_local.publish_local({
        "description": "A second heat map of the same talkers",
        "name": "Talker heat",
        "base": "talkers",
    })
    assert second["ok"] is True
    assert second["id"] == "talker-heat-2"


def test_publish_description_yaml_body(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    _repo(tmp_path, monkeypatch)
    info = plugin_local.publish_local({
        "description": "id: brief-view\nname: Brief\nversion: 1\n",
    })
    assert info["ok"] is True
    assert info["id"] == "brief-view"
    assert (paths.plugin_local_runtime_dir() / "brief-view" / "visualisation.yml").is_file()


def test_src_owns_remints_local(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    repo = _repo(tmp_path, monkeypatch)
    src = repo / "plugins" / "src" / "local-demo"
    src.mkdir(parents=True)
    (src / "plugin.yml").write_text(MINIMAL, encoding="utf-8")
    info = plugin_local.publish_local({"files": {"plugin.yml": MINIMAL}})
    assert info["ok"] is True
    assert info["id"] == "local-demo-2"
    assert info["remintedFrom"] == "local-demo"
    assert (paths.plugin_local_dir() / "local-demo-2.zip").is_file()
    assert not (paths.plugin_local_dir() / "local-demo.zip").exists()


def test_overwrite_and_same_sha(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    _repo(tmp_path, monkeypatch)
    files = {"plugin.yml": MINIMAL, "visualisation.yml": "engine: graph\nbase: topology\n"}
    first = plugin_local.publish_local({"files": files})
    assert first["wrote"] is True
    again = plugin_local.publish_local({"files": files})
    assert again["ok"] is True
    assert again["wrote"] is False
    other = plugin_local.publish_local({
        "files": {"plugin.yml": "id: local-demo\nname: Local demo\nversion: 2\n"},
    })
    assert other["ok"] is True
    assert other["id"] == "local-demo-2"
    assert other["remintedFrom"] == "local-demo"
    forced = plugin_local.publish_local({
        "files": {"plugin.yml": "id: local-demo\nname: Local demo\nversion: 2\n"},
        "overwrite": True,
    })
    assert forced["ok"] is True
    assert forced["id"] == "local-demo"
    assert forced["version"] == 2


GOOD_INSTALL_VIZ = (
    "engine: graph\n"
    "settings:\n"
    "  presetField: preset\n"
    "  presets:\n"
    "    - id: a\n"
    "      label: A\n"
    "      values: {gain: 1, preset: a}\n"
    "config:\n"
    "  - key: preset\n"
    "    type: select\n"
    "    values: [[a, A]]\n"
    "  - key: gain\n"
    "    type: number\n"
    "    min: 0\n"
    "    max: 10\n"
)


def test_invalid_zip_leaves_no_drop_zone_or_runtime(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, _isolate_plugin_local: Path,
) -> None:
    _repo(tmp_path, monkeypatch)
    raw = _zip({
        "plugin.yml": "id: ghost-pack\nname: Ghost\nversion: 1\n",
        "visualisation.yml": (
            "engine: graph\n"
            "settings:\n"
            "  presets:\n"
            "    - id: a\n"
            "      label: A\n"
            "      values: {gain: 1}\n"
            "config:\n"
            "  - key: gain\n"
            "    type: number\n"
            "    min: 0\n"
            "    max: 10\n"
        ),
    })
    with pytest.raises(ValueError, match="presetField"):
        plugin_local.install_local_zip(raw)
    assert not (paths.plugin_local_dir() / "ghost-pack.zip").is_file()
    assert not (paths.plugin_local_runtime_dir() / "ghost-pack").is_dir()


def test_invalid_overwrite_keeps_previous_pack(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, _isolate_plugin_local: Path,
) -> None:
    _repo(tmp_path, monkeypatch)
    good = _zip({
        "plugin.yml": "id: keep-pack\nname: Keep\nversion: 1\n",
        "visualisation.yml": GOOD_INSTALL_VIZ,
    })
    plugin_local.install_local_zip(good)
    bad = _zip({
        "plugin.yml": "id: keep-pack\nname: Keep\nversion: 1\n",
        "visualisation.yml": (
            "engine: graph\n"
            "settings:\n"
            "  presets:\n"
            "    - id: a\n"
            "      label: A\n"
            "      values: {gain: 1}\n"
            "config:\n"
            "  - key: gain\n"
            "    type: number\n"
            "    min: 0\n"
            "    max: 10\n"
        ),
    })
    with pytest.raises(ValueError, match="presetField"):
        plugin_local.install_local_zip(bad, overwrite=True)
    plugins.validate_plugin_home(paths.plugin_local_runtime_dir() / "keep-pack")


def test_fixed_zip_reinstalls_without_overwrite_after_failed_overwrite(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, _isolate_plugin_local: Path,
) -> None:
    _repo(tmp_path, monkeypatch)
    good = _zip({
        "plugin.yml": "id: keep-pack\nname: Keep\nversion: 1\n",
        "visualisation.yml": GOOD_INSTALL_VIZ,
    })
    plugin_local.install_local_zip(good)
    bad = _zip({
        "plugin.yml": "id: keep-pack\nname: Keep\nversion: 2\n",
        "visualisation.yml": (
            "engine: graph\n"
            "settings:\n"
            "  presets:\n"
            "    - id: a\n"
            "      label: A\n"
            "      values: {gain: 1}\n"
            "config:\n"
            "  - key: gain\n"
            "    type: number\n"
            "    min: 0\n"
            "    max: 10\n"
        ),
    })
    with pytest.raises(ValueError, match="presetField"):
        plugin_local.install_local_zip(bad, overwrite=True)
    fixed = _zip({
        "plugin.yml": "id: keep-pack\nname: Keep\nversion: 2\n",
        "visualisation.yml": GOOD_INSTALL_VIZ,
    })
    info = plugin_local.install_local_zip(fixed, overwrite=True)
    assert info["wrote"] is True
    plugins.validate_plugin_home(paths.plugin_local_runtime_dir() / "keep-pack")


def test_install_rejects_invalid_merged_settings(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, _isolate_plugin_local: Path,
) -> None:
    _repo(tmp_path, monkeypatch)
    raw = _zip({
        "plugin.yml": "id: bad-install\nname: Bad\nversion: 1\n",
        "visualisation.yml": (
            "engine: graph\n"
            "settings:\n"
            "  presets:\n"
            "    - id: a\n"
            "      label: A\n"
            "      values: {gain: 1}\n"
            "config:\n"
            "  - key: gain\n"
            "    type: number\n"
            "    min: 0\n"
            "    max: 10\n"
        ),
    })
    with pytest.raises(ValueError, match="presetField"):
        plugin_local.install_local_zip(raw)


def test_code_zip_installs_without_activate(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    _repo(tmp_path, monkeypatch)
    monkeypatch.setattr(plugins, "CONSENT_FILE", tmp_path / "plugin-consent.yml")
    live.reset_for_tests()
    raw = _zip({
        "plugin.yml": MINIMAL + "backend:\n  entry: backend/service.py\n",
        "backend/service.py": "def setup(host):\n    pass\n",
        "visualisation.yml": "engine: graph\nbase: topology\n",
    })
    info = plugin_local.install_local_zip(raw)
    assert info["consentRequired"] is True
    assert info["activated"] is False
    assert (paths.plugin_local_dir() / "local-demo.zip").is_file()
    patch = live.snapshot()["patch"]
    assert patch["reloadPlugins"] is True
    assert "mode" not in patch


def test_watch_activates_new_drop_not_startup(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, _isolate_plugin_local: Path,
) -> None:
    _repo(tmp_path, monkeypatch)
    live.reset_for_tests()
    drop = paths.plugin_local_dir(create=True)
    src = tmp_path / "pack"
    src.mkdir()
    (src / "plugin.yml").write_text(MINIMAL, encoding="utf-8")
    (src / "visualisation.yml").write_text("engine: graph\nbase: topology\n", encoding="utf-8")
    pz.pack_tree(src, drop / "local-demo.zip")
    first = plugin_local.sync_local_drop()
    assert first == []
    live.reset_for_tests()
    other = tmp_path / "pack2"
    other.mkdir()
    (other / "plugin.yml").write_text("id: second-drop\nname: Second\nversion: 1\n", encoding="utf-8")
    (other / "visualisation.yml").write_text("engine: graph\nbase: topology\n", encoding="utf-8")
    pz.pack_tree(other, drop / "second-drop.zip")
    nxt = plugin_local.sync_local_drop()
    assert len(nxt) == 1
    assert nxt[0]["id"] == "second-drop"
    assert nxt[0]["activated"] is True


def test_mcp_publish_local_plugin(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    _repo(tmp_path, monkeypatch)
    live.reset_for_tests()
    call = plugin_mcp.call_tool("publish_local_plugin", {
        "description": "A quiet topology glance",
        "id": "quiet-glance",
        "name": "Quiet glance",
    })
    payload = json.loads(call["content"][0]["text"])
    assert call["isError"] is False
    assert payload["ok"] is True
    assert payload["id"] == "quiet-glance"
    assert payload["activated"] is True
    assert (paths.plugin_local_dir() / "quiet-glance.zip").is_file()
