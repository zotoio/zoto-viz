from __future__ import annotations

from pathlib import Path

import pytest

from service import plugin_manifest_block as pmb
from service import plugins


def _repo(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    repo = tmp_path / "checkout"
    (repo / "plugins" / "src").mkdir(parents=True)
    (repo / "plugins" / ".runtime").mkdir(parents=True)
    monkeypatch.setenv("ZOTO_VIZ_REPO_ROOT", str(repo))
    return repo


def test_unknown_visualisation_keys_become_blocked_catalog_row(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, _isolate_plugin_local: Path,
) -> None:
    repo = _repo(tmp_path, monkeypatch)
    home = repo / "plugins" / "src" / "blocked-keys"
    home.mkdir(parents=True)
    (home / "plugin.yml").write_text(
        "id: blocked-keys\nname: Blocked Keys\nversion: 1\nengine: graph\n",
        encoding="utf-8",
    )
    (home / "visualisation.yml").write_text(
        "engine: graph\nunknownManifestKey: true\n",
        encoding="utf-8",
    )
    plugins.reset_bundles()
    result = plugins.scan()
    ids = {p["id"] for p in result["plugins"]}
    assert "blocked-keys" not in ids
    blocked = result.get("blocked") or []
    row = next(b for b in blocked if b["id"] == "blocked-keys")
    assert row["reasonCode"] == pmb.REASON_MANIFEST_UNKNOWN_KEYS
    assert "unknownManifestKey" in row.get("keys", [])
    assert "doesn't recognise" in row["message"]
    assert "blocked-keys" in row["message"]


def test_newer_sdk_becomes_blocked_catalog_row(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, _isolate_plugin_local: Path,
) -> None:
    repo = _repo(tmp_path, monkeypatch)
    home = repo / "plugins" / "src" / "future-pack"
    home.mkdir(parents=True)
    (home / "plugin.yml").write_text(
        "id: future-pack\nname: Future\nversion: 1\nengine: graph\n"
        f"zoto_sdk_version: {pmb.HOST_ZOTO_SDK_VERSION + 1}\n",
        encoding="utf-8",
    )
    (home / "visualisation.yml").write_text("engine: graph\n", encoding="utf-8")
    plugins.reset_bundles()
    result = plugins.scan()
    assert "future-pack" not in {p["id"] for p in result["plugins"]}
    row = next(b for b in (result.get("blocked") or []) if b["id"] == "future-pack")
    assert row["reasonCode"] == pmb.REASON_MANIFEST_NEWER_SDK
    assert "newer version" in row["message"].lower()
