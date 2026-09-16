from __future__ import annotations

import json
import subprocess
from pathlib import Path

import pytest
import yaml

from service import plugin_migration as pmg
from service import plugin_zip as pz


def _repo(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    repo = tmp_path / "checkout"
    (repo / "plugins" / "src").mkdir(parents=True)
    monkeypatch.setenv("ZOTO_VIZ_REPO_ROOT", str(repo))
    return repo


def _git_init(repo: Path) -> None:
    subprocess.run(["git", "init"], cwd=repo, check=True, capture_output=True)
    subprocess.run(["git", "config", "user.email", "t@t.test"], cwd=repo, check=True, capture_output=True)
    subprocess.run(["git", "config", "user.name", "t"], cwd=repo, check=True, capture_output=True)
    subprocess.run(["git", "config", "commit.gpgsign", "false"], cwd=repo, check=True, capture_output=True)


def test_migrate_flat_yaml_and_skip_if_present(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys) -> None:
    repo = _repo(tmp_path, monkeypatch)
    home = tmp_path / "home-plugins"
    home.mkdir()
    (home / "custom.yml").write_text(
        "id: custom\nname: Custom\nversion: 1\nengine: graph\nbase: topology\n",
        encoding="utf-8",
    )
    (home / "sample.yml").write_text("id: sample\nname: Sample\nversion: 1\n", encoding="utf-8")
    packed = repo / "plugins" / "src" / "sample"
    packed.mkdir()
    (packed / "plugin.yml").write_text("id: sample\nname: Sample\nversion: 1\n", encoding="utf-8")

    result = pmg.migrate_home_plugins(repo_root=repo, home_plugins=home, home_agents=tmp_path / "none")
    assert "custom" in result["copied"]
    assert "sample" in result["skipped"]
    dest = repo / "plugins" / "src" / "custom"
    assert (dest / "plugin.yml").is_file()
    assert (dest / "visualisation.yml").is_file()
    plugin = yaml.safe_load((dest / "plugin.yml").read_text(encoding="utf-8"))
    viz = yaml.safe_load((dest / "visualisation.yml").read_text(encoding="utf-8"))
    assert plugin["id"] == "custom"
    assert "engine" not in plugin
    assert viz["engine"] == "graph"
    out = capsys.readouterr().out
    assert "[plugin-migrate] custom copied to plugins/src/custom/" in out
    assert "it is live in the catalog" in out
    assert "plugin pack" not in out


def test_migrate_agent_plugin_layout(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys) -> None:
    repo = _repo(tmp_path, monkeypatch)
    agent_home = tmp_path / "agent-plugins" / "lan-pulse"
    (agent_home / "scripts" / "frontend").mkdir(parents=True)
    (agent_home / "scripts" / "backend").mkdir(parents=True)
    (agent_home / "skills" / "generate-ui").mkdir(parents=True)
    (agent_home / "ui").mkdir()
    (agent_home / "manifest.json").write_text(json.dumps({
        "id": "lan-pulse",
        "name": "LAN Pulse",
        "version": 1,
        "hint": "heat",
        "produces": ["graph"],
        "consumes": ["devices"],
        "engine": "graph",
        "base": "talkers",
        "capabilities": ["graph.read", "graph.style"],
        "scripts": {
            "frontend": "scripts/frontend/index.ts",
            "backend": "scripts/backend/service.py",
        },
    }), encoding="utf-8")
    (agent_home / "scripts" / "frontend" / "index.ts").write_text("export {}\n", encoding="utf-8")
    (agent_home / "scripts" / "backend" / "service.py").write_text("def setup(host):\n    pass\n", encoding="utf-8")
    (agent_home / "skills" / "generate-ui" / "SKILL.md").write_text("# skill\n", encoding="utf-8")
    (agent_home / "ui" / "prompt.md").write_text("prompt\n", encoding="utf-8")

    result = pmg.migrate_home_plugins(
        repo_root=repo, home_plugins=tmp_path / "views", home_agents=tmp_path / "agent-plugins",
    )
    assert result["copied"] == ["lan-pulse"]
    dest = repo / "plugins" / "src" / "lan-pulse"
    assert (dest / "frontend" / "index.ts").is_file()
    assert (dest / "backend" / "service.py").is_file()
    assert not (dest / "skills").exists()
    assert not (dest / "ui").exists()
    plugin = yaml.safe_load((dest / "plugin.yml").read_text(encoding="utf-8"))
    assert plugin["frontend"]["entry"] == "frontend/index.ts"
    assert plugin["datasource"]["produces"] == ["graph"]
    assert (agent_home / "manifest.json").is_file()
    out = capsys.readouterr().out
    assert "dropped skills/, ui/" in out


def test_migrate_does_not_pack_or_commit(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    repo = _repo(tmp_path, monkeypatch)
    _git_init(repo)
    subprocess.run(["git", "add", "plugins"], cwd=repo, check=True, capture_output=True)
    subprocess.run(["git", "commit", "--allow-empty", "-m", "init"], cwd=repo, check=True, capture_output=True)
    before = subprocess.run(
        ["git", "rev-parse", "HEAD"], cwd=repo, capture_output=True, text=True, check=True,
    ).stdout.strip()
    home = tmp_path / "views"
    home.mkdir()
    (home / "solo.yml").write_text("id: solo\nname: Solo\nversion: 1\n", encoding="utf-8")
    pmg.migrate_home_plugins(repo_root=repo, home_plugins=home, home_agents=tmp_path / "none")
    after = subprocess.run(
        ["git", "rev-parse", "HEAD"], cwd=repo, capture_output=True, text=True, check=True,
    ).stdout.strip()
    assert after == before
    cached = subprocess.run(
        ["git", "diff", "--cached"], cwd=repo, capture_output=True, text=True, check=True,
    )
    assert cached.stdout.strip() == ""
    assert not (repo / "plugins" / "solo.zip").exists()
    assert (repo / "plugins" / "src" / "solo" / "plugin.yml").is_file()


def test_dirty_tree_fail_closed_when_git_missing(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    repo = _repo(tmp_path, monkeypatch)

    def boom(*_a, **_k):
        raise FileNotFoundError(2, "No such file or directory", "git")

    monkeypatch.setattr(pmg.subprocess, "run", boom)
    found = pmg.dirty_tree_paths("sample", repo)
    assert found == [pmg.GIT_UNAVAILABLE]


def test_dirty_tree_fail_closed_when_git_status_fails(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    repo = _repo(tmp_path, monkeypatch)
    found = pmg.dirty_tree_paths("sample", repo)
    assert found == [pmg.GIT_UNAVAILABLE]

    def fail_status(*_a, **_k):
        return subprocess.CompletedProcess(["git", "status"], 128, stdout="", stderr="fatal: not a git repository")

    monkeypatch.setattr(pmg.subprocess, "run", fail_status)
    again = pmg.dirty_tree_paths("sample", repo)
    assert again == [pmg.GIT_UNAVAILABLE]


def test_catalog_ids_src_or_zip(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    repo = _repo(tmp_path, monkeypatch)
    src = repo / "plugins" / "src" / "alpha"
    src.mkdir(parents=True)
    (src / "plugin.yml").write_text("id: alpha\nname: Alpha\nversion: 1\n", encoding="utf-8")
    (repo / "plugins" / "beta.zip").write_bytes(b"PK\x03\x04")
    ids = pmg.catalog_ids(repo)
    assert "alpha" in ids
    assert "beta" in ids


def test_dirty_tree_ignores_gitignored_zip(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    repo = _repo(tmp_path, monkeypatch)
    _git_init(repo)
    (repo / ".gitignore").write_text("plugins/*.zip\nplugins/.runtime/\n", encoding="utf-8")
    subprocess.run(["git", "add", ".gitignore"], cwd=repo, check=True, capture_output=True)
    subprocess.run(["git", "commit", "-m", "ignore"], cwd=repo, check=True, capture_output=True)
    src = repo / "plugins" / "src" / "sample"
    src.mkdir(parents=True)
    (src / "plugin.yml").write_text("id: sample\nname: Sample\nversion: 1\n", encoding="utf-8")
    pz.pack_tree(src, repo / "plugins" / "sample.zip")
    found = pmg.dirty_tree_paths("sample", repo)
    assert not any(p.endswith("sample.zip") for p in found)
    assert any("plugins/src/sample" in p for p in found)


def test_migrate_skips_zip_owned_id(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    repo = _repo(tmp_path, monkeypatch)
    home = tmp_path / "home-plugins"
    home.mkdir()
    (home / "contrib.yml").write_text("id: contrib\nname: Contrib\nversion: 1\n", encoding="utf-8")
    (repo / "plugins" / "contrib.zip").write_bytes(b"PK\x03\x04")
    result = pmg.migrate_home_plugins(repo_root=repo, home_plugins=home, home_agents=tmp_path / "none")
    assert "contrib" in result["skipped"]
    assert not (repo / "plugins" / "src" / "contrib").exists()
