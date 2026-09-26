"""Cursor bridge must find Node 22 when systemd's PATH has none."""
from __future__ import annotations

from pathlib import Path

from service import cursor_agent


def test_find_node_prefers_nvm_when_path_node_is_old(tmp_path: Path, monkeypatch) -> None:
    cursor_agent._node_cache = None
    home = tmp_path / "home"
    new = home / ".nvm" / "versions" / "node" / "v22.23.2" / "bin" / "node"
    new.parent.mkdir(parents=True)
    new.write_text("", encoding="utf-8")
    old = tmp_path / "usr" / "bin" / "node"
    old.parent.mkdir(parents=True)
    old.write_text("", encoding="utf-8")

    def probe(path: str) -> tuple[int, int] | None:
        if path == str(old):
            return (18, 20)
        if path == str(new):
            return (22, 23)
        return None

    monkeypatch.setattr(cursor_agent, "_probe_node", probe)
    monkeypatch.setattr(cursor_agent.shutil, "which", lambda _name: str(old))
    monkeypatch.setattr(cursor_agent.Path, "home", lambda: home)
    monkeypatch.delenv("NVM_DIR", raising=False)
    assert cursor_agent._find_node() == str(new)


def test_find_node_keeps_path_node_when_it_is_new_enough(tmp_path: Path, monkeypatch) -> None:
    cursor_agent._node_cache = None
    system = tmp_path / "node"
    system.write_text("", encoding="utf-8")
    monkeypatch.setattr(cursor_agent, "_probe_node", lambda path: (22, 14) if path == str(system) else None)
    monkeypatch.setattr(cursor_agent.shutil, "which", lambda _name: str(system))
    monkeypatch.setattr(cursor_agent, "_node_candidates", lambda: [])
    assert cursor_agent._find_node() == str(system)
