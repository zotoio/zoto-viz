"""Install pipeline UX tests — enable after PR #35 lands and #38 rebases onto it."""
from __future__ import annotations

import hashlib
import io
import zipfile
from pathlib import Path

import pytest

from service import paths
from service import plugin_local
from service import plugins

pytestmark = pytest.mark.skip(reason="Owned by PR #35 install pipeline; re-enable after rebase")

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


def _hash_tree(root: Path) -> str:
    digest = hashlib.sha256()
    for path in sorted(root.rglob("*")):
        if path.is_file():
            digest.update(str(path.relative_to(root)).encode())
            digest.update(path.read_bytes())
    return digest.hexdigest()


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


def _v1_keep_pack_files() -> dict[str, str]:
    return {
        "plugin.yml": "id: keep-pack\nname: Keep\nversion: 1\n",
        "visualisation.yml": GOOD_INSTALL_VIZ,
    }


def _bad_v2_keep_pack_viz() -> str:
    return (
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
    )


def test_blocked_v2_overwrite_preserves_v1_catalog_message_and_tree(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, _isolate_plugin_local: Path,
) -> None:
    _repo(tmp_path, monkeypatch)
    plugin_local.publish_local({"files": _v1_keep_pack_files()})
    runtime = paths.plugin_local_runtime_dir() / "keep-pack"
    tree_before = _hash_tree(runtime)
    blocked = plugin_local.publish_local({
        "files": {
            "plugin.yml": "id: keep-pack\nname: Keep\nversion: 2\n",
            "visualisation.yml": _bad_v2_keep_pack_viz(),
        },
        "overwrite": True,
    })
    assert blocked["ok"] is False
    assert blocked["error"] == "install_blocked"
    assert blocked["message"] == "v2 was blocked; v1 is still running"
    assert _hash_tree(runtime) == tree_before
    row = next(p for p in plugins.scan()["plugins"] if p["id"] == "keep-pack")
    assert row["version"] == 1
