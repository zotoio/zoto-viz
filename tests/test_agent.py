from __future__ import annotations

import asyncio
import json
from types import SimpleNamespace
from pathlib import Path

from service import agent
from service import plugins

ROOT = Path(__file__).resolve().parents[1]


class Req:
    def __init__(self, body=None, content_type: str = "application/json", content_length=None) -> None:
        self._body = body
        self.content_type = content_type
        self.content_length = content_length
        self.method = "GET"
        self.app = {"state": SimpleNamespace(devices={}, flows={})}

    async def json(self):
        if self._body is None:
            raise ValueError("invalid")
        return self._body


def test_model_rejects_junk() -> None:
    assert agent._model({"model": "gemma4:e4b"}) == "gemma4:e4b"
    assert agent._model({"model": "../../etc"}) == "gemma4"
    assert agent._model({}) == "gemma4"


def test_match_model_expands_short_tag() -> None:
    names = ["gemma4:e2b-it-qat", "gemma4:e4b", "gemma4:e2b", "llama3.2:latest"]
    assert agent.match_model("gemma4", names) == "gemma4:e2b-it-qat"
    assert agent.match_model("gemma4:e2b", names) == "gemma4:e2b"
    assert agent.match_model("missing", names) == "missing"


def test_chat_options_cpu_for_gemma4(monkeypatch) -> None:
    monkeypatch.delenv("ZOTO_VIZ_OLLAMA_NUM_GPU", raising=False)
    gemma = agent.chat_options("gemma4:e4b")
    assert gemma["num_gpu"] == 0
    assert gemma["num_ctx"] == 2048
    assert gemma["temperature"] == 0.3
    llama = agent.chat_options("llama3.2:latest")
    assert "num_gpu" not in llama
    monkeypatch.setenv("ZOTO_VIZ_OLLAMA_NUM_GPU", "99")
    assert agent.chat_options("gemma4:e2b")["num_gpu"] == 99
    monkeypatch.setenv("ZOTO_VIZ_OLLAMA_NUM_GPU", "nope")
    assert agent.chat_options("gemma4")["num_gpu"] == 0


def test_ollama_url_loopback() -> None:
    assert agent.ollama_url().startswith("http://127.0.0.1")


def test_ollama_url_rejects_lan(monkeypatch) -> None:
    monkeypatch.setattr(agent, "OLLAMA", "http://192.168.1.5:11434")
    try:
        agent.ollama_url()
        raise AssertionError("expected loopback-only")
    except ValueError:
        pass
    monkeypatch.setattr(agent, "OLLAMA", "http://127.0.0.1:11434")


def test_redact_state_masks_ip() -> None:
    snap = agent._redact_state(
        {"devices": [{"ip": "192.168.86.10", "role": "lan", "names": ["nest"], "bytes_in": 1, "bytes_out": 2}]},
        True,
    )
    assert snap["devices"][0]["ip"] == "x.x.x.x"
    assert "name" not in snap["devices"][0]
    open_ = agent._redact_state(
        {"devices": [{"ip": "192.168.86.10", "role": "lan", "names": ["nest"], "bytes_in": 1, "bytes_out": 2}]},
        False,
    )
    assert open_["devices"][0]["ip"] == "192.168.86.10"
    assert open_["devices"][0]["name"] == ["nest"]
    skip = agent._redact_state({"devices": ["skip", {}]}, False)
    assert skip["devices"][0]["ip"] is None


def test_api_status_offline(monkeypatch) -> None:
    monkeypatch.setattr(agent, "OLLAMA", "http://8.8.8.8:11434")
    resp = asyncio.run(agent.api_status(Req()))
    assert resp.status == 200
    monkeypatch.setattr(agent, "OLLAMA", "http://127.0.0.1:11434")


def test_api_chat_validation() -> None:
    assert asyncio.run(agent.api_chat(Req(content_type="text/plain"))).status == 400
    assert asyncio.run(agent.api_chat(Req())).status == 400
    assert asyncio.run(agent.api_chat(Req([]))).status == 400
    assert asyncio.run(agent.api_chat(Req({"messages": []}))).status == 400


def test_api_chat_rejects_lan_ollama(monkeypatch) -> None:
    monkeypatch.setattr(agent, "OLLAMA", "http://10.0.0.9:11434")
    resp = asyncio.run(agent.api_chat(Req({"messages": [{"role": "user", "content": "hi"}]})))
    assert resp.status == 400
    monkeypatch.setattr(agent, "OLLAMA", "http://127.0.0.1:11434")


def test_api_draft_plugin(tmp_path, monkeypatch) -> None:
    yaml_text = (ROOT / "examples" / "plugins" / "topology.yml").read_text(encoding="utf-8")
    preview = asyncio.run(agent.api_draft_plugin(Req({"yaml": yaml_text})))
    assert preview.status == 200
    empty = asyncio.run(agent.api_draft_plugin(Req({"yaml": " "})))
    assert empty.status == 400
    bad = asyncio.run(agent.api_draft_plugin(Req({"yaml": "id: 1"})))
    assert bad.status == 200
    monkeypatch.setattr(plugins, "DIR", tmp_path)
    monkeypatch.setattr(agent, "ai_control_on", lambda: False)
    blocked = asyncio.run(agent.api_draft_plugin(Req({"yaml": yaml_text, "aiControl": True, "install": True})))
    assert blocked.status == 200
    assert json.loads(blocked.body)["installed"] is False
    assert not (tmp_path / "topology.yml").is_file()
    monkeypatch.setattr(agent, "ai_control_on", lambda: True)
    installed = asyncio.run(agent.api_draft_plugin(Req({"yaml": yaml_text, "aiControl": False, "install": True})))
    assert installed.status == 200
    assert json.loads(installed.body)["installed"] is True
    assert (tmp_path / "topology.yml").is_file()
    invalid = asyncio.run(agent.api_draft_plugin(Req()))
    assert invalid.status == 400


def test_chat_rejects_huge_body() -> None:
    assert asyncio.run(agent.api_chat(Req({"messages": [{"role": "user", "content": "hi"}]}, content_length=agent.MAX_BODY + 1))).status == 413


def test_api_status_includes_tts(monkeypatch) -> None:
    monkeypatch.setattr(agent, "OLLAMA", "http://8.8.8.8:11434")
    monkeypatch.setattr(agent, "speak_engine", lambda: "spd-say")
    resp = asyncio.run(agent.api_status(Req()))
    assert json.loads(resp.body)["tts"] == "spd-say"
    monkeypatch.setattr(agent, "OLLAMA", "http://127.0.0.1:11434")


def test_ai_control_file(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(agent, "AI_CONTROL_FILE", tmp_path / "ai-control")
    monkeypatch.delenv("ZOTO_VIZ_AI_CONTROL", raising=False)
    assert agent.ai_control_on() is False
    agent.set_ai_control(True)
    assert agent.ai_control_on() is True
    monkeypatch.setenv("ZOTO_VIZ_AI_CONTROL", "1")
    agent.set_ai_control(False)
    assert agent.ai_control_on() is True
    monkeypatch.setenv("ZOTO_VIZ_AI_CONTROL", "0")
    assert agent.ai_control_on() is False
    monkeypatch.delenv("ZOTO_VIZ_AI_CONTROL", raising=False)
    agent.set_ai_control(False)
    assert agent.ai_control_on() is False
    get_resp = asyncio.run(agent.api_control(Req()))
    assert get_resp.status == 200
    put_on = Req({"on": True})
    put_on.method = "PUT"
    on = asyncio.run(agent.api_control(put_on))
    assert json.loads(on.body)["aiControl"] is True
    put_off = Req({"on": False})
    put_off.method = "PUT"
    off = asyncio.run(agent.api_control(put_off))
    assert json.loads(off.body)["aiControl"] is False
    put_bad = Req()
    put_bad.method = "PUT"
    bad = asyncio.run(agent.api_control(put_bad))
    assert bad.status == 400
    put_list = Req([])
    put_list.method = "PUT"
    not_obj = asyncio.run(agent.api_control(put_list))
    assert not_obj.status == 400
