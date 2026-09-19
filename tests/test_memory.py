from __future__ import annotations

import json
from pathlib import Path

from service import memory


def _iso(tmp_path: Path, monkeypatch) -> Path:
    d = tmp_path / "agent"
    monkeypatch.setattr(memory, "agent_dir", lambda: d)
    return d


def test_roll_abbreviates_and_keeps_ui_log(tmp_path: Path, monkeypatch) -> None:
    _iso(tmp_path, monkeypatch)
    assert memory.abbreviate([]) == ""
    assert memory.abbreviate([{"role": "user", "content": "```yaml\nid: x\n```"}]) == ""
    brief = memory.abbreviate(
        [{"role": "user", "content": "remember 192.168.1.9 is the printer"}, {"role": "assistant", "content": "noted"}],
        redact=True,
    )
    assert "192.168.1.9" not in brief
    assert "printer" in brief
    long_parts = [{"role": "user", "content": f"turn {i} " + ("word " * 40)} for i in range(20)]
    assert "…" in memory.abbreviate(long_parts)
    assert memory.estimate_tokens("") == 0
    assert memory.estimate_tokens("abcd") >= 1
    assert memory.maybe_roll(force=True) is None
    for i in range(8):
        memory.append_message("user", f"q{i} nest speaker")
        memory.append_message("assistant", f"a{i} kitchen is quiet")
    assert len(memory.messages()) == 16
    rolled = memory.maybe_roll(force=True, keep=4)
    assert rolled is not None
    assert rolled.get("new_session") is True
    tail = memory.ollama_tail()
    assert not any(str(m.get("content") or "").startswith("Session brief") for m in tail)
    assert [m["role"] for m in tail] == ["user"]
    assert tail[0]["content"].startswith("q7")
    assert memory.ui_messages()[0]["content"].startswith("q0")
    assert memory.messages()[-1]["content"].startswith("a7")
    live = [m["content"] for m in tail]
    assert "q0 nest speaker" not in live
    assert not any(c.startswith("a") for c in live)
    memory.maybe_roll(extra_tokens=0, budget_tokens=10_000_000)
    memory.append_message("user", "tiny")
    memory.append_message("assistant", "yep")
    assert memory.maybe_roll(extra_tokens=50_000, budget_tokens=10, keep=1) is not None
    memory.clear_conversation()
    assert memory.messages() == []
    assert memory.ollama_tail() == []


def test_roll_through_tracks_trim(tmp_path: Path, monkeypatch) -> None:
    _iso(tmp_path, monkeypatch)
    monkeypatch.setattr(memory, "CONV_MAX", 6)
    for i in range(4):
        memory.append_message("user", f"u{i}")
        memory.append_message("assistant", f"a{i}")
    memory.maybe_roll(force=True, keep=2)
    data = json.loads((tmp_path / "agent" / "conversation.json").read_text(encoding="utf-8"))
    through = data["rolls"][-1]["through"]
    assert through >= 1
    memory.append_message("user", "new")
    memory.append_message("assistant", "ok")
    data = json.loads((tmp_path / "agent" / "conversation.json").read_text(encoding="utf-8"))
    assert len(data["messages"]) == 6
    assert data["rolls"][-1]["through"] <= through
    memory.append_message("user", "   ")
    memory.append_message("system", "nope")
    (tmp_path / "agent" / "conversation.json").write_text(
        json.dumps({"messages": [{"role": "user", "content": "x"}], "rolls": [{"through": "nope", "summary": "s"}]}),
        encoding="utf-8",
    )
    tail = memory.ollama_tail()
    assert not any(str(m.get("content") or "").startswith("Session brief") for m in tail)
    assert tail[-1]["content"] == "x"


def test_append_and_ui_tail(tmp_path: Path, monkeypatch) -> None:
    _iso(tmp_path, monkeypatch)
    memory.append_message("user", "   ")
    memory.append_message("user", "hello nest")
    memory.append_message("user", "hello nest")
    memory.append_message("assistant", "the nest is quiet", thinking="because it is idle")
    rows = memory.messages()
    assert rows[-1]["thinking"] == "because it is idle"
    assert memory.ui_messages()[-1]["thinking"] == "because it is idle"
    d = _iso(tmp_path, monkeypatch)
    (d / "conversation.json").write_text(json.dumps({"messages": ["x", {"role": "user", "content": "ok"}]}), encoding="utf-8")
    assert memory.messages()[-1]["content"] == "ok"
    memory.harvest("hello", "chat failed", redact=False)
    memory.harvest("hello", "err", redact=False)
    assert memory.delete_memory("missing") is False
    memory.add_memory("guest ssid is the printer", kind="memory")
    assert memory.add_memory("guest ssid is the printer", kind="memory") is None
    assert memory.forget("") == 0
    memory.harvest("remember the nest is in the kitchen", "ok", redact=False)
    memory.harvest("forget that", "ok", redact=False)
    assert memory.ui_messages()[0]["role"] == "user"
    memory.clear_conversation()
    assert memory.messages() == []


def test_harvest_remember_fence_highlight_forget(tmp_path: Path, monkeypatch) -> None:
    _iso(tmp_path, monkeypatch)
    memory.harvest("remember the nest is in the kitchen", "ok", redact=False)
    assert any("kitchen" in m["text"] for m in memory.list_memories(kind="memory"))
    memory.harvest("what is loud?", "```memory\nssid guest is the printer\n```", redact=False)
    assert any("printer" in m["text"] for m in memory.list_memories(kind="memory"))
    memory.harvest(
        "devices?",
        "```memory\n[\"ssid guest is the printer\", {\"text\":\"roku is the lounge tv\"}]\n```",
        redact=False,
    )
    texts = " ".join(m["text"] for m in memory.list_memories(kind="memory"))
    assert "printer" in texts and "roku" in texts
    memory.harvest(
        "call me andrew",
        "```memory\n{\"text\":\"operator is andrew\"}\n```",
        redact=False,
    )
    assert any("andrew" in m["text"] for m in memory.list_memories(kind="memory"))
    dropped = memory.forget("kitchen")
    assert dropped >= 1
    memory.harvest("forget that", "ok", redact=False)
    memory.harvest("note that the garage cam is offline overnight", "```memory\n{not-json}\n```", redact=False)
    assert any("garage" in m["text"] or "not-json" in m["text"] for m in memory.list_memories())


def test_redact_strips_ip(tmp_path: Path, monkeypatch) -> None:
    _iso(tmp_path, monkeypatch)
    memory.harvest("remember 192.168.1.9 is the printer", "noted", redact=True)
    texts = [m["text"] for m in memory.list_memories()]
    assert all("192.168.1.9" not in t for t in texts)


def test_recall_prefers_memories(tmp_path: Path, monkeypatch) -> None:
    _iso(tmp_path, monkeypatch)
    memory.add_memory("guest ssid is the printer", kind="memory")
    memory.add_memory("who is talking · three hosts on udp", kind="highlight")
    hits = memory.recall("printer on the guest ssid")
    assert hits and "printer" in hits[0]


def test_facts_window_slides_to_token_budget(tmp_path: Path, monkeypatch) -> None:
    _iso(tmp_path, monkeypatch)
    memory.add_memory("the nest speaker is in the kitchen", kind="memory")
    for i in range(12):
        memory.add_memory(f"turn {i} · nest cam was loud at {i} Mbps on the guest ssid", kind="highlight")
    tight = memory.facts_window(query="nest kitchen", max_tokens=80)
    assert tight.startswith("Facts (outcomes to reuse")
    assert "kitchen" in tight
    assert memory.estimate_tokens(tight) <= 80
    wide = memory.facts_window(query="nest", max_tokens=400)
    assert memory.estimate_tokens(wide) <= 400
    assert wide.count("- ") >= tight.count("- ")
    injected = memory.inject_block("kitchen")
    assert injected.startswith("\nFacts")
    memory.append_message("user", "who is loud?")
    memory.append_message("assistant", "the nest cam · thinking leftover", thinking="long chain of thought about bitrate")
    tail = memory.ollama_tail()
    assert tail == [{"role": "user", "content": "who is loud?"}]
    assert "thinking leftover" not in json.dumps(tail)
    memory.harvest(
        "make a pulse view",
        "```yaml plugin.yml\nid: pulse\nname: Pulse\nversion: 1\n```\n```settings\n{\"theme\":\"ember\"}\n```\nready",
        redact=False,
    )
    facts = memory.facts_window(query="pulse", max_tokens=256)
    assert "built plugin pulse" in facts
    assert "changed theme" in facts
    memory.add_memory("operator is andrew", kind="memory")
    memory.clear_conversation()
    kinds = {m["kind"] for m in memory.list_memories()}
    assert "highlight" not in kinds
    assert any("andrew" in m["text"] or "kitchen" in m["text"] for m in memory.list_memories(kind="memory"))


def test_corrupt_files_are_empty(tmp_path: Path, monkeypatch) -> None:
    d = _iso(tmp_path, monkeypatch)
    d.mkdir(parents=True, exist_ok=True)
    (d / "conversation.json").write_text("not-json", encoding="utf-8")
    (d / "memories.json").write_text("[]", encoding="utf-8")
    assert memory.messages() == []
    assert memory.list_memories() == []
    assert memory.delete_memory("") is False
    assert memory.add_memory("ab", kind="memory") is None
    memory.clear_memories()
    assert json.loads((d / "memories.json").read_text(encoding="utf-8")) == {"memories": []}
