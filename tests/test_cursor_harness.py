from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path

import pytest

from service import cursor_agent
from service import memory
from service import paths


@pytest.fixture(autouse=True)
def _session_file(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    dest = tmp_path / "cursor-session.json"
    monkeypatch.setenv("ZOTO_VIZ_CURSOR_SESSION", str(dest))
    return dest


def test_session_roundtrip_and_clear(tmp_path: Path) -> None:
    dest = Path(os.environ["ZOTO_VIZ_CURSOR_SESSION"])
    cursor_agent.remember_session({"session": {"agentId": "agent-abc", "model": "grok-4.6"}})
    got = cursor_agent.read_session()
    assert got["agentId"] == "agent-abc"
    assert got["model"] == "grok-4.6"
    assert dest.stat().st_mode & 0o777 == 0o600
    cursor_agent.clear_session()
    assert cursor_agent.read_session() == {}
    assert not dest.exists()


def test_history_delete_clears_cursor_session(monkeypatch: pytest.MonkeyPatch) -> None:
    cursor_agent.remember_session({"stats": {"agentId": "agent-old", "model": "grok-4.6"}})
    monkeypatch.setattr(memory, "clear_conversation", lambda: None)
    req = type("Req", (), {"method": "DELETE"})()
    from service import agent
    import asyncio
    resp = asyncio.run(agent.api_history(req))
    assert resp.status == 200
    assert cursor_agent.read_session() == {}


def test_node_harness_session_and_tools(tmp_path: Path) -> None:
    dest = tmp_path / "sess.json"
    script = """
import { clearSession, readSession, toolPolicy, turnText, writeSession } from "./harness.mjs";
const off = toolPolicy(false);
if (!off.tools.includes("mcp") || !off.disallowedTools.includes("shell")) process.exit(2);
const on = toolPolicy(true);
if (!on.tools.includes("mcp") || on.disallowedTools) process.exit(3);
if (turnText({ system: "ID", prompt: "hi", resumed: false }) !== "ID\\n\\nhi") process.exit(4);
if (turnText({ system: "ID", prompt: "hi", resumed: true }) !== "hi") process.exit(5);
writeSession({ agentId: "agent-1", model: "grok-4.6" });
const got = readSession();
if (!got || got.agentId !== "agent-1") process.exit(6);
clearSession();
if (readSession()) process.exit(7);
process.stdout.write("ok\\n");
"""
    env = os.environ.copy()
    env["ZOTO_VIZ_CURSOR_SESSION"] = str(dest)
    out = subprocess.check_output(
        ["node", "--input-type=module", "-e", script],
        cwd=str(paths.repo_root() / "service" / "cursor-bridge"),
        env=env,
        text=True,
    )
    assert out.strip() == "ok"
