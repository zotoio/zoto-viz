from __future__ import annotations

import asyncio
import json
from types import SimpleNamespace
from pathlib import Path

from service import live
from service import agent
from service import memory
from service import plugins

ROOT = Path(__file__).resolve().parents[1]


class Req:
    def __init__(self, body=None, content_type: str = "application/json", content_length=None) -> None:
        self._body = body
        self.content_type = content_type
        self.content_length = content_length
        self.method = "GET"
        self.app = {"state": SimpleNamespace(devices={}, flows={})}
        self.rel_url = SimpleNamespace(query={})

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
    live.reset_for_tests()
    monkeypatch.delenv("ZOTO_VIZ_OLLAMA_NUM_GPU", raising=False)
    monkeypatch.delenv("ZOTO_VIZ_OLLAMA_NUM_CTX", raising=False)
    gemma = agent.chat_options("gemma4:e4b")
    assert gemma["num_gpu"] == 0
    assert "num_ctx" not in gemma
    assert gemma["temperature"] == agent.live.ollama_temperature(agent.live.temper())
    llama = agent.chat_options("llama3.2:latest")
    assert "num_gpu" not in llama
    assert "num_ctx" not in llama
    monkeypatch.setenv("ZOTO_VIZ_OLLAMA_NUM_GPU", "99")
    assert agent.chat_options("gemma4:e2b")["num_gpu"] == 99
    monkeypatch.setenv("ZOTO_VIZ_OLLAMA_NUM_GPU", "nope")
    assert agent.chat_options("gemma4")["num_gpu"] == 0
    monkeypatch.setenv("ZOTO_VIZ_OLLAMA_NUM_CTX", "32768")
    assert agent.chat_options("gemma4")["num_ctx"] == 32768
    monkeypatch.setenv("ZOTO_VIZ_OLLAMA_NUM_CTX", "64")
    assert agent.chat_options("gemma4")["num_ctx"] == 512
    monkeypatch.setenv("ZOTO_VIZ_OLLAMA_NUM_CTX", "999999")
    assert agent.chat_options("llama3.2")["num_ctx"] == 131072
    monkeypatch.setenv("ZOTO_VIZ_OLLAMA_NUM_CTX", "nope")
    assert "num_ctx" not in agent.chat_options("gemma4")


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
    assert snap["top"][0]["n"] == "x"
    assert "ip" not in snap["top"][0]
    open_ = agent._redact_state(
        {"devices": [{"ip": "192.168.86.10", "role": "lan", "names": ["nest"], "bytes_in": 1, "bytes_out": 2}]},
        False,
    )
    assert open_["top"][0]["n"] == "nest"
    assert open_["top"][0]["b"] == 3
    skip = agent._redact_state({"devices": ["skip", {}]}, False)
    assert skip["n"] == 1
    assert skip["top"] == []


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


def test_parse_sky_recipe() -> None:
    rec = agent.parse_sky_recipe(
        {"name": "wake", "motif": 2, "a": [0.1, 0.2, 0.3], "b": [0.9, 0.8, 0.7], "warp": 0.2, "grain": 0.8, "bands": 6}
    )
    assert rec["name"] == "wake"
    assert rec["motif"] == 2
    assert rec["a"] == [0.1, 0.2, 0.3]
    clamped = agent.parse_sky_recipe(
        '```json\n{"name":"x","motif":9,"a":[2,0,0],"b":[0,0,0],"warp":-1,"grain":2,"bands":99}\n```'
    )
    assert clamped["motif"] == 5
    assert clamped["a"][0] == 1.0
    assert clamped["warp"] == 0.0
    assert clamped["grain"] == 1.0
    assert clamped["bands"] == 12.0
    assert agent.parse_sky_recipe("nope") is None


def test_api_sky_rejects_lan_ollama(monkeypatch) -> None:
    monkeypatch.setattr(agent, "OLLAMA", "http://10.0.0.9:11434")
    resp = asyncio.run(agent.api_sky(Req({})))
    assert resp.status == 400
    monkeypatch.setattr(agent, "OLLAMA", "http://127.0.0.1:11434")


def test_api_sky_parses_ollama(monkeypatch) -> None:
    class Reply:
        def __init__(self, data):
            self._data = data

        async def json(self, content_type=None):
            return self._data

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

    class Tags(Reply):
        def __init__(self):
            super().__init__({"models": [{"name": "gemma4:e2b"}]})

    class Sess:
        def __init__(self, chat):
            self._chat = chat

        def get(self, url):
            return Tags()

        def post(self, url, json=None):
            return Reply(self._chat)

    class CM:
        def __init__(self, chat):
            self._chat = chat

        async def __aenter__(self):
            return Sess(self._chat)

        async def __aexit__(self, *a):
            return False

    recipe = {"name": "wake", "motif": 1, "a": [0.1, 0.2, 0.3], "b": [0.9, 0.8, 0.7], "warp": 0.2, "grain": 0.4, "bands": 3}
    monkeypatch.setattr(agent, "ClientSession", lambda timeout=None: CM({"message": {"content": json.dumps(recipe)}}))
    ok = asyncio.run(agent.api_sky(Req({"model": "gemma4"})))
    assert ok.status == 200
    assert json.loads(ok.body)["recipe"]["name"] == "wake"
    monkeypatch.setattr(agent, "ClientSession", lambda timeout=None: CM({"message": {"content": "nope"}}))
    bad = asyncio.run(agent.api_sky(Req({})))
    assert bad.status == 502
    monkeypatch.setattr(agent, "ClientSession", lambda timeout=None: CM({"error": "down"}))
    err = asyncio.run(agent.api_sky(Req({})))
    assert err.status == 502


def test_sky_user_prefixes_view_prompt() -> None:
    text = agent.sky_user({"view": "cores", "prompt": "harbour dusk\x00"}, hour=21, devices=12)
    assert "view=cores." in text
    assert "Operator brief: harbour dusk" in text
    assert "\x00" not in text
    assert "hour=21" in text
    bare = agent.sky_user({}, hour=3, devices=0)
    assert "Operator brief" not in bare
    assert "view=" not in bare
    again = agent.sky_user({"previous": {"name": "harbour", "motif": 0}}, hour=12, devices=3)
    assert "Previous was harbour motif=0" in again
    assert "far-apart palette" in again


def test_system_drafts_unified_plugin_tree() -> None:
    prompt = agent.SYSTEM
    assert "plugin.yml" in prompt
    assert "visualisation.yml" in prompt
    assert "frontend/" in prompt
    assert "backend/" in prompt
    assert "datasource/" in prompt
    assert "sky/" in prompt
    assert "view-plugin" not in prompt.lower()
    assert "runtime: typescript" not in prompt
    assert "physics field" in prompt
    assert "eases palettes and physics" in prompt


def test_api_draft_plugin(tmp_path, monkeypatch) -> None:
    yaml_text = (ROOT / "plugins" / "src" / "topology" / "plugin.yml").read_text(encoding="utf-8")
    files = {"plugin.yml": yaml_text}
    preview = asyncio.run(agent.api_draft_plugin(Req({"files": files})))
    assert preview.status == 200
    empty = asyncio.run(agent.api_draft_plugin(Req({"files": {}})))
    assert empty.status == 400
    bad = asyncio.run(agent.api_draft_plugin(Req({"files": {"plugin.yml": "id: 1"}})))
    assert bad.status == 200
    repo = tmp_path / "checkout"
    (repo / "plugins" / "src").mkdir(parents=True)
    monkeypatch.setenv("ZOTO_VIZ_REPO_ROOT", str(repo))
    monkeypatch.setattr(agent, "ai_control_on", lambda: False)
    blocked = asyncio.run(agent.api_draft_plugin(Req({"files": files, "aiControl": True, "install": True})))
    assert blocked.status == 200
    assert json.loads(blocked.body)["installed"] is False
    assert not (repo / "plugins" / "src" / "topology" / "plugin.yml").is_file()
    monkeypatch.setattr(agent, "ai_control_on", lambda: True)
    installed = asyncio.run(agent.api_draft_plugin(Req({"files": files, "aiControl": False, "install": True})))
    assert installed.status == 200
    body = json.loads(installed.body)
    assert body["installed"] is True
    assert body["written"]
    assert "plugins/src/topology" in body["hint"]
    assert "plugin pack topology" in body["hint"]
    assert "-o" in body["hint"]
    assert (repo / "plugins" / "src" / "topology" / "plugin.yml").is_file()
    yaml_fallback = asyncio.run(agent.api_draft_plugin(Req({"yaml": yaml_text})))
    assert yaml_fallback.status == 200
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


def test_parse_ollama_stream() -> None:
    assert agent.parse_ollama_stream('{"message":{"content":"hi"}}') == "hi"
    assert agent.parse_ollama_stream('{"error":"nope"}') == "nope"
    ndjson = '{"message":{"content":"hel"}}\n{"message":{"content":"lo"}}\n'
    assert agent.parse_ollama_stream(ndjson) == "hello"
    assert "plain" in agent.parse_ollama_stream("plain")
    assert agent.parse_ollama_stream('{"message":{"content":"x"}}\n[1]\nnot json') == "x[1]not json"
    think, said = agent.parse_ollama_chat('{"message":{"thinking":"why","content":"hi"}}')
    assert think == "why" and said == "hi"
    think, said = agent.parse_ollama_chat('{"message":{"content":"<think>plan</think>ok"}}')
    assert think == "plan" and said == "ok"


def test_last_user_and_chat_messages(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(memory, "agent_dir", lambda: tmp_path / "agent")
    msgs = [
        {"role": "user", "content": "who is the nest?", "images": ["abc"]},
        "skip",
    ]
    user = agent._last_user(msgs)
    assert user == "who is the nest?"
    memory.append_message("user", user)
    memory.append_message("assistant", "kitchen speaker")
    memory.add_memory("the nest is in the kitchen", kind="memory")
    built = agent._chat_messages(msgs, snap={"devices": [], "flows": 0}, user=user)
    assert built[0]["role"] == "system"
    assert "kitchen" in built[0]["content"]
    assert "Temper" in built[0]["content"]
    assert "Weather" in built[0]["content"]
    assert built[-1]["content"] == "kitchen speaker"
    monkeypatch.setattr(memory, "agent_dir", lambda: tmp_path / "empty-agent")
    fallback = agent._chat_messages(
        [{"role": "user", "content": "hi there nest"}],
        snap={"devices": [], "flows": 0},
        user="hi there nest",
    )
    assert fallback[-1]["content"] == "hi there nest"
    class Boom:
        @property
        def devices(self):
            raise RuntimeError("no")
    assert agent._snapshot(Boom(), False) == {"n": 0, "fl": 0, "top": []}
    msgs = [{"role": "user", "content": "hi"}]
    built = agent._chat_messages(msgs, snap={"n": 0, "fl": 0, "top": []}, user="hi")
    assert "images" not in built[-1]
    agent._remember_reply("", "", redact=False)
    agent._remember_reply("who is the nest?", "kitchen speaker", redact=False)
    assert memory.messages()[-1]["content"] == "kitchen speaker"
    assert "{" in agent.parse_ollama_stream("{")
    assert agent._parse_view({}, False) == ""
    note = agent._parse_view({
        "view": {
            "hud": {"m": "talkers", "sel": "192.168.86.40", "hide": "inet,mc"},
            "screenshot": "data:image/jpeg;base64," + ("A" * 40),
        }
    }, True)
    assert "Screen:" in note
    assert "x.x.x.x" in note
    assert "192.168.86.40" not in note
    assert "A" * 40 not in note
    packed = agent.compact_hud({
        "mode": "talkers",
        "theme": "matrix",
        "dream": True,
        "merge": False,
        "redact": True,
        "selected": "192.168.86.40",
        "stats": {"pps": "12", "bps": "1.2 MB/s", "lan": "8/6", "net": "wlan0 10.0.0.1"},
        "show": {"internet": False, "multicast": False, "lan": True},
        "feed": {"on": True, "layout": "ticker", "source": "transcript", "scope": "lan", "lines": ["you hi"]},
    }, redact=True)
    assert packed["m"] == "talkers"
    assert packed["d"] == 1
    assert packed["mg"] == 0
    assert packed["hide"] == "inet,mc"
    assert "10.0.0.1" not in packed["st"]
    assert agent._parse_view({"view": {"screenshot": "short"}}, False) == ""
    assert agent._parse_screenshot({}) == ""
    assert agent._parse_screenshot({"view": {"screenshot": "short"}}) == ""
    long_shot = "A" * 40
    assert agent._parse_screenshot({"view": {"screenshot": "data:image/jpeg;base64," + long_shot}}) == long_shot
    assert agent._parse_screenshot({"view": {"screenshot": long_shot}}) == long_shot
    with_img = [{"role": "system", "content": "x"}, {"role": "user", "content": "what is this?"}]
    agent._attach_image(with_img, long_shot)
    assert with_img[-1]["images"] == [long_shot]
    with_view = agent._chat_messages(
        [{"role": "user", "content": "what is loud?"}],
        snap={"n": 0, "fl": 0, "top": []},
        user="hi",
        view_note="\nScreen: {\"m\":\"talkers\"}",
    )
    assert "Screen:" in with_view[0]["content"]
    assert agent._ctx_overflow(b'{"error":{"code":400,"message":"request (2099 tokens) exceeds the available context size"}}')
    assert agent._ctx_overflow('exceed_context_size_error')
    assert not agent._ctx_overflow("hello")
    assert agent._chat_budget(True) < agent._chat_budget(False)


def test_chat_messages_rolls_old_turns(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(memory, "agent_dir", lambda: tmp_path / "agent")
    for i in range(8):
        memory.append_message("user", f"q{i} nest")
        memory.append_message("assistant", f"a{i} kitchen")
    built = agent._chat_messages(
        [{"role": "user", "content": "q7 nest"}],
        snap={"devices": [], "flows": 0},
        user="q7 nest",
    )
    assert not any(str(m.get("content") or "").startswith("Session brief") for m in built)
    assert memory.ui_messages()[0]["content"].startswith("q0")
    assert built[-1]["content"].startswith("a7") or built[-1]["content"].startswith("q7")


class _Chunks:
    def __init__(self, parts: list[bytes]) -> None:
        self.parts = parts

    async def iter_any(self):
        for p in self.parts:
            yield p


class _Post:
    def __init__(self, parts: list[bytes]) -> None:
        self.content = _Chunks(parts)

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False


class _Sess:
    def __init__(self, parts: list[bytes]) -> None:
        self.parts = parts

    def post(self, url, json=None):
        return _Post(self.parts)


class _Sink:
    def __init__(self) -> None:
        self.out = bytearray()

    async def write(self, chunk):
        self.out.extend(chunk)


def test_pipe_holds_overflow_then_echoes(tmp_path, monkeypatch) -> None:
    overflow = b'{"error":{"message":"request (2099 tokens) exceeds the available context size (2048 tokens)"}}'
    sink = _Sink()
    buf, streamed = asyncio.run(agent._pipe_ollama(_Sess([overflow]), "http://127.0.0.1:11434", {}, sink))[:2]
    assert streamed is False
    assert sink.out == b""
    assert agent._ctx_overflow(buf)
    sink2 = _Sink()
    buf2, streamed2, stalled2 = asyncio.run(
        agent._pipe_ollama(_Sess([b'{"message":{"content":"ok"}}']), "http://127.0.0.1:11434", {}, sink2, hold_overflow=False)
    )
    assert streamed2 is True
    assert stalled2 is False
    assert b"ok" in sink2.out
    assert b"ok" in buf2


class _Stall:
    async def iter_any(self):
        yield b'{"message":{"thinking":"halfway"}}'
        raise TimeoutError()


class _StallPost:
    def __init__(self) -> None:
        self.content = _Stall()

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False


def test_pipe_stall_returns_partial() -> None:
    class Sess:
        def post(self, url, json=None):
            return _StallPost()

    sink = _Sink()
    buf, streamed, stalled = asyncio.run(agent._pipe_ollama(Sess(), "http://127.0.0.1:11434", {}, sink, hold_overflow=False))
    assert stalled is True
    assert streamed is True
    assert b"halfway" in buf


def test_api_chat_retries_overflow(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(memory, "agent_dir", lambda: tmp_path / "agent")
    n = {"i": 0}

    async def fake_pipe(s, base, payload, resp, hold_overflow=True):
        n["i"] += 1
        assert payload.get("think") is False
        if n["i"] == 1:
            return bytearray(b'{"error":{"message":"exceeds the available context size"}}'), False, False
        return bytearray(b'{"message":{"content":"ok later"}}\n'), True, False

    class Tags:
        async def json(self):
            return {"models": [{"name": "gemma4:e2b"}]}

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

    class Sess:
        def get(self, url):
            return Tags()

    class CM:
        async def __aenter__(self):
            return Sess()

        async def __aexit__(self, *a):
            return False

    class FakeResp:
        def __init__(self, *a, **k):
            self.status = 200

        async def prepare(self, req):
            return None

        async def write(self, chunk):
            return None

        async def write_eof(self):
            return None

    monkeypatch.setattr(agent, "ClientSession", lambda timeout=None: CM())
    monkeypatch.setattr(agent, "_pipe_ollama", fake_pipe)
    monkeypatch.setattr(agent.web, "StreamResponse", FakeResp)
    out = asyncio.run(agent.api_chat(Req({"messages": [{"role": "user", "content": "hi"}]})))
    assert n["i"] == 2
    assert memory.messages()[-1]["content"] == "ok later"
    assert out.status == 200


def test_reply_incomplete() -> None:
    assert agent.reply_incomplete('{"message":{"thinking":"plan the lan"},"done":true}')
    assert agent.reply_incomplete('{"message":{"content":"hello"},"done":true,"done_reason":"length"}')
    assert agent.reply_incomplete('{"message":{"content":"```yaml\\nid: x\\n"}}')
    assert agent.reply_incomplete('{"message":{"content":"partial"}}', stalled=True)
    assert agent.reply_incomplete("", stalled=True)
    assert not agent.reply_incomplete('{"message":{"content":"the nest is loud."},"done":true,"done_reason":"stop"}')
    assert not agent.reply_incomplete('{"error":{"message":"exceeds the available context size"}}')
    think, content = agent.parse_ollama_chat('{"message":{"thinking":"why"}}')
    msgs = agent._nudge_messages([{"role": "user", "content": "hi"}], think, content)
    assert msgs[-1]["content"] == agent.ANSWER_NOW
    msgs2 = agent._nudge_messages(
        [{"role": "user", "content": "hi"}],
        "",
        "half a sent",
    )
    assert msgs2[-2]["content"] == "half a sent"
    assert msgs2[-1]["content"] == agent.NUDGE


def test_api_chat_nudges_incomplete(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(memory, "agent_dir", lambda: tmp_path / "agent")
    n = {"i": 0}
    seen: list[str] = []

    async def fake_pipe(s, base, payload, resp, hold_overflow=True):
        n["i"] += 1
        last = str((payload.get("messages") or [{}])[-1].get("content") or "")
        seen.append(last)
        if n["i"] == 1:
            return bytearray(b'{"message":{"thinking":"still working this out"}}\n{"done":true}\n'), True, False
        return bytearray(b'{"message":{"content":"kitchen speaker"}}\n'), True, False

    class Tags:
        async def json(self):
            return {"models": [{"name": "gemma4:e2b"}]}

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

    class Sess:
        def get(self, url):
            return Tags()

    class CM:
        async def __aenter__(self):
            return Sess()

        async def __aexit__(self, *a):
            return False

    class FakeResp:
        def __init__(self, *a, **k):
            self.status = 200

        async def prepare(self, req):
            return None

        async def write(self, chunk):
            return None

        async def write_eof(self):
            return None

    monkeypatch.setattr(agent, "ClientSession", lambda timeout=None: CM())
    monkeypatch.setattr(agent, "_pipe_ollama", fake_pipe)
    monkeypatch.setattr(agent.web, "StreamResponse", FakeResp)
    out = asyncio.run(agent.api_chat(Req({"messages": [{"role": "user", "content": "who is the nest?"}]})))
    assert n["i"] == 2
    assert any("Stop reasoning" in s for s in seen)
    assert memory.messages()[-1]["content"] == "kitchen speaker"
    assert memory.messages()[-2]["content"] == "who is the nest?"
    assert out.status == 200


def test_api_chat_polls_until_reply(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(memory, "agent_dir", lambda: tmp_path / "agent")
    n = {"i": 0}

    async def fake_pipe(s, base, payload, resp, hold_overflow=True):
        n["i"] += 1
        if n["i"] < 3:
            return bytearray(b'{"message":{"thinking":"still working this out"}}\n{"done":true}\n'), True, False
        return bytearray(b'{"message":{"content":"the nest is the kitchen speaker"}}\n'), True, False

    class Tags:
        async def json(self):
            return {"models": [{"name": "gemma4:e2b"}]}

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

    class Sess:
        def get(self, url):
            return Tags()

    class CM:
        async def __aenter__(self):
            return Sess()

        async def __aexit__(self, *a):
            return False

    class FakeResp:
        def __init__(self, *a, **k):
            self.status = 200

        async def prepare(self, req):
            return None

        async def write(self, chunk):
            return None

        async def write_eof(self):
            return None

    monkeypatch.setattr(agent, "ClientSession", lambda timeout=None: CM())
    monkeypatch.setattr(agent, "_pipe_ollama", fake_pipe)
    monkeypatch.setattr(agent.web, "StreamResponse", FakeResp)
    out = asyncio.run(agent.api_chat(Req({"messages": [{"role": "user", "content": "who is the nest?"}]})))
    assert n["i"] == 3
    assert memory.messages()[-1]["content"] == "the nest is the kitchen speaker"
    assert out.status == 200


def test_api_chat_poll_skips_user_persist(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(memory, "agent_dir", lambda: tmp_path / "agent")
    memory.append_message("user", "who is the nest?")
    memory.append_message("assistant", "", thinking="still working this out")
    n = {"i": 0}

    async def fake_pipe(s, base, payload, resp, hold_overflow=True):
        n["i"] += 1
        last = str((payload.get("messages") or [{}])[-1].get("content") or "")
        assert "Stop reasoning" in last
        return bytearray(b'{"message":{"content":"kitchen speaker"}}\n'), True, False

    class Tags:
        async def json(self):
            return {"models": [{"name": "gemma4:e2b"}]}

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

    class Sess:
        def get(self, url):
            return Tags()

    class CM:
        async def __aenter__(self):
            return Sess()

        async def __aexit__(self, *a):
            return False

    class FakeResp:
        def __init__(self, *a, **k):
            self.status = 200

        async def prepare(self, req):
            return None

        async def write(self, chunk):
            return None

        async def write_eof(self):
            return None

    monkeypatch.setattr(agent, "ClientSession", lambda timeout=None: CM())
    monkeypatch.setattr(agent, "_pipe_ollama", fake_pipe)
    monkeypatch.setattr(agent.web, "StreamResponse", FakeResp)
    out = asyncio.run(agent.api_chat(Req({
        "poll": True,
        "messages": [{"role": "user", "content": "who is the nest?"}],
    })))
    users = [m for m in memory.messages() if m["role"] == "user"]
    assert len(users) == 1
    assert n["i"] == 1
    assert memory.messages()[-1]["content"] == "kitchen speaker"
    assert out.status == 200


def test_api_history_and_memories(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(memory, "agent_dir", lambda: tmp_path / "agent")
    memory.append_message("user", "hello")
    memory.append_message("assistant", "hi")
    got = asyncio.run(agent.api_history(Req()))
    body = json.loads(got.body)
    assert body["ok"] is True
    assert body["messages"][-1]["content"] == "hi"
    req = Req({"text": "the lounge tv is a roku"})
    req.method = "POST"
    saved = asyncio.run(agent.api_memories(req))
    saved_body = json.loads(saved.body)
    assert saved_body["ok"] is True
    mem_id = saved_body["memory"]["id"]
    listed = asyncio.run(agent.api_memories(Req()))
    assert any(m["id"] == mem_id for m in json.loads(listed.body)["memories"])
    drop = Req({"id": mem_id})
    drop.method = "DELETE"
    gone = asyncio.run(agent.api_memories(drop))
    assert json.loads(gone.body)["ok"] is True
    empty = Req({"text": "ab"})
    empty.method = "POST"
    assert asyncio.run(agent.api_memories(empty)).status == 400
    wipe = Req({})
    wipe.method = "DELETE"
    assert json.loads(asyncio.run(agent.api_memories(wipe)).body)["memories"] == []
    cleared = Req()
    cleared.method = "DELETE"
    hist = asyncio.run(agent.api_history(cleared))
    assert json.loads(hist.body)["messages"] == []
    bad = Req()
    bad.method = "POST"
    assert asyncio.run(agent.api_memories(bad)).status == 400
    not_obj = Req([])
    not_obj.method = "POST"
    assert asyncio.run(agent.api_memories(not_obj)).status == 400
    drop_q = Req()
    drop_q.method = "DELETE"
    drop_q.content_type = "text/plain"
    drop_q.rel_url = SimpleNamespace(query={"id": "nope"})
    assert asyncio.run(agent.api_memories(drop_q)).status == 200
    bad_del = Req()
    bad_del.method = "DELETE"
    assert asyncio.run(agent.api_memories(bad_del)).status == 200
    list_del = Req([1])
    list_del.method = "DELETE"
    assert json.loads(asyncio.run(agent.api_memories(list_del)).body)["ok"] is True

