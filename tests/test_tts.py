from __future__ import annotations

import asyncio
import json
from types import SimpleNamespace

from service import tts


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


def _no_neural(monkeypatch) -> None:
    monkeypatch.delenv("ELEVENLABS_API_KEY", raising=False)
    monkeypatch.delenv("XI_API_KEY", raising=False)
    monkeypatch.delenv("ZOTO_VIZ_TTS", raising=False)
    monkeypatch.delenv("ZOTO_VIZ_TTS_URL", raising=False)
    monkeypatch.delenv("ZOTO_VIZ_PIPER_MODEL", raising=False)
    monkeypatch.setattr(tts, "piper_model", lambda: None)
    monkeypatch.setattr(tts, "piper_bin", lambda: None)


def test_speak_engine_espeak(monkeypatch) -> None:
    _no_neural(monkeypatch)
    monkeypatch.setattr(tts.shutil, "which", lambda n: "/usr/bin/espeak-ng" if n == "espeak-ng" else None)
    assert tts.speak_engine() == "espeak-ng"
    monkeypatch.setattr(tts.shutil, "which", lambda n: "/usr/bin/espeak" if n == "espeak" else None)
    assert tts.speak_engine() == "espeak"
    monkeypatch.setattr(tts.shutil, "which", lambda n: "/usr/bin/spd-say" if n == "spd-say" else None)
    assert tts.speak_engine() == "spd-say"
    monkeypatch.setattr(tts.shutil, "which", lambda _n: None)
    assert tts.speak_engine() is None


def test_speak_engine_neural(monkeypatch) -> None:
    _no_neural(monkeypatch)
    monkeypatch.setattr(tts.shutil, "which", lambda _n: None)
    monkeypatch.setenv("ELEVENLABS_API_KEY", "sk-test")
    assert tts.speak_engine() == "elevenlabs"
    monkeypatch.delenv("ELEVENLABS_API_KEY")
    monkeypatch.setenv("ZOTO_VIZ_TTS_URL", "http://127.0.0.1:8880")
    assert tts.speak_engine() == "openai"
    monkeypatch.setenv("ZOTO_VIZ_TTS", "espeak")
    monkeypatch.setattr(tts.shutil, "which", lambda n: "/usr/bin/spd-say" if n == "spd-say" else None)
    assert tts.speak_engine() == "spd-say"
    monkeypatch.setenv("ZOTO_VIZ_TTS", "elevenlabs")
    monkeypatch.delenv("ELEVENLABS_API_KEY", raising=False)
    assert tts.speak_engine() is None
    monkeypatch.setenv("ZOTO_VIZ_TTS", "off")
    assert tts.speak_engine() is None


def test_tts_url_loopback(monkeypatch) -> None:
    monkeypatch.setenv("ZOTO_VIZ_TTS_URL", "http://127.0.0.1:8880/v1")
    assert tts.tts_url() == "http://127.0.0.1:8880/v1"
    monkeypatch.setenv("ZOTO_VIZ_TTS_URL", "http://192.168.1.5:8880")
    try:
        tts.tts_url()
        raise AssertionError("expected loopback-only")
    except ValueError:
        pass
    monkeypatch.delenv("ZOTO_VIZ_TTS_URL")
    assert tts.tts_url() is None


def test_speech_url() -> None:
    assert tts.speech_url("http://127.0.0.1:8880") == "http://127.0.0.1:8880/v1/audio/speech"
    assert tts.speech_url("http://127.0.0.1:8880/v1") == "http://127.0.0.1:8880/v1/audio/speech"


def test_tts_rate(monkeypatch) -> None:
    monkeypatch.delenv("ZOTO_VIZ_TTS_RATE", raising=False)
    assert tts.tts_rate("elevenlabs") == 24000
    monkeypatch.setenv("ZOTO_VIZ_TTS_RATE", "16000")
    assert tts.tts_rate("openai") == 16000
    monkeypatch.setenv("ZOTO_VIZ_TTS_RATE", "nope")
    assert tts.tts_rate("openai") == 24000


def test_tts_voice(monkeypatch) -> None:
    monkeypatch.delenv("ELEVENLABS_VOICE_ID", raising=False)
    monkeypatch.delenv("ZOTO_VIZ_TTS_VOICE", raising=False)
    assert tts.tts_voice("af_bella", "openai") == "af_bella"
    assert tts.tts_voice("af_sky+af_bella", "openai") == "af_sky+af_bella"
    assert tts.tts_voice("../etc", "elevenlabs") == tts.ELEVEN_VOICE
    assert tts.tts_voice("", "elevenlabs") == tts.ELEVEN_VOICE


def test_eleven_base(monkeypatch) -> None:
    monkeypatch.delenv("ELEVENLABS_API_BASE", raising=False)
    assert tts.eleven_base() == "https://api.elevenlabs.io"
    monkeypatch.setenv("ELEVENLABS_API_BASE", "https://evil.example")
    assert tts.eleven_base() == "https://api.elevenlabs.io"
    monkeypatch.setenv("ELEVENLABS_API_BASE", "https://api.eu.residency.elevenlabs.io")
    assert tts.eleven_base() == "https://api.eu.residency.elevenlabs.io"


def test_piper_rate(tmp_path) -> None:
    model = tmp_path / "en.onnx"
    model.write_bytes(b"x")
    (tmp_path / "en.onnx.json").write_text(json.dumps({"audio": {"sample_rate": 16000}}), encoding="utf-8")
    assert tts.piper_rate(model) == 16000
    (tmp_path / "en.onnx.json").unlink()
    assert tts.piper_rate(model) == 22050


def test_speak_cmd_espeak(monkeypatch) -> None:
    monkeypatch.setattr(tts.shutil, "which", lambda n: f"/usr/bin/{n}")
    assert tts._speak_cmd("espeak-ng", "hello") == ["/usr/bin/espeak-ng", "-v", "en", "-s", "160", "hello"]
    assert tts._speak_cmd("spd-say", "hello")[-1] == "hello"


def test_host_say(monkeypatch) -> None:
    class Proc:
        returncode = 0
        async def wait(self):
            return 0
        def kill(self):
            self.returncode = -9

    seen: list[tuple] = []

    async def exec(*cmd, **_kw):
        seen.append(cmd)
        return Proc()

    async def noop() -> None:
        return None

    monkeypatch.setattr(tts, "cancel_speak", noop)
    monkeypatch.setattr(tts.asyncio, "create_subprocess_exec", exec)
    monkeypatch.setattr(tts, "speak_engine", lambda: "spd-say")
    monkeypatch.setattr(tts.shutil, "which", lambda n: f"/usr/bin/{n}")
    assert asyncio.run(tts.host_say("hello")) == "spd-say"
    assert seen[0][0].endswith("spd-say")
    monkeypatch.setattr(tts, "speak_engine", lambda: "elevenlabs")
    assert asyncio.run(tts.host_say("hello")) is None


def test_host_say_timeout(monkeypatch) -> None:
    class Proc:
        returncode = None
        async def wait(self):
            await asyncio.sleep(30)
        def kill(self):
            self.returncode = -9

    async def exec(*_a, **_kw):
        return Proc()

    hits = []

    async def cancel() -> None:
        hits.append(1)

    monkeypatch.setattr(tts, "cancel_speak", cancel)
    monkeypatch.setattr(tts.asyncio, "create_subprocess_exec", exec)
    monkeypatch.setattr(tts, "speak_engine", lambda: "espeak-ng")

    async def boom(aw, timeout=None):
        if asyncio.iscoroutine(aw):
            aw.close()
        raise asyncio.TimeoutError

    monkeypatch.setattr(tts.asyncio, "wait_for", boom)
    assert asyncio.run(tts.host_say("hello")) is None
    assert hits


def test_cancel_speak(monkeypatch) -> None:
    class Proc:
        returncode = None
        def kill(self):
            self.returncode = -9
        async def wait(self):
            self.returncode = -9
            return -9

    tts._speak_proc = Proc()
    seen: list[tuple] = []

    async def exec(*cmd, **_kw):
        seen.append(cmd)
        p = Proc()
        p.returncode = 0
        return p

    monkeypatch.setattr(tts.shutil, "which", lambda n: "/usr/bin/spd-say" if n == "spd-say" else None)
    monkeypatch.setattr(tts.asyncio, "create_subprocess_exec", exec)
    asyncio.run(tts.cancel_speak())
    assert tts._speak_proc is None
    assert seen and seen[0][1] == "-C"


def test_api_speak_validation() -> None:
    assert asyncio.run(tts.api_speak(Req(content_type="text/plain"))).status == 400
    assert asyncio.run(tts.api_speak(Req())).status == 400
    assert asyncio.run(tts.api_speak(Req({}))).status == 400
    assert asyncio.run(tts.api_speak(Req({"text": "  "}))).status == 400
    assert asyncio.run(tts.api_speak(Req([]))).status == 400
    assert asyncio.run(tts.api_speak(Req({"text": "hi"}, content_length=tts.TTS_CAP + 600))).status == 413


def test_api_speak_host(monkeypatch) -> None:
    _no_neural(monkeypatch)
    monkeypatch.setattr(tts, "speak_engine", lambda: "spd-say")

    async def say(text: str):
        assert text == "hello there"
        return "spd-say"
    monkeypatch.setattr(tts, "host_say", say)
    resp = asyncio.run(tts.api_speak(Req({"text": "hello there"})))
    assert resp.status == 200
    assert json.loads(resp.body)["engine"] == "spd-say"

    async def missing(_: str):
        return None
    monkeypatch.setattr(tts, "host_say", missing)
    gone = asyncio.run(tts.api_speak(Req({"text": "hello"})))
    assert gone.status == 503


def test_api_speak_cancel(monkeypatch) -> None:
    hits = []

    async def cancel() -> None:
        hits.append(1)
    monkeypatch.setattr(tts, "cancel_speak", cancel)
    req = Req()
    req.method = "DELETE"
    resp = asyncio.run(tts.api_speak(req))
    assert resp.status == 200
    assert hits == [1]


def test_api_speak_stream_branch(monkeypatch) -> None:
    seen = []

    async def fake_stream(req, engine, text, voice):
        seen.append((engine, text, voice))
        return type("R", (), {"status": 200})()

    monkeypatch.setattr(tts, "speak_engine", lambda: "elevenlabs")
    monkeypatch.setattr(tts, "stream_speak", fake_stream)
    resp = asyncio.run(tts.api_speak(Req({"text": "hi", "voice": "af_heart"})))
    assert resp.status == 200
    assert seen == [("elevenlabs", "hi", "af_heart")]


def test_iter_eleven_pcm(monkeypatch) -> None:
    class FakeContent:
        async def iter_any(self):
            yield b"\x00\x01"
            yield b"\x02\x03"

    class FakeResp:
        status = 200
        content = FakeContent()

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_a):
            return False

        async def text(self):
            return ""

    class FakeSession:
        def __init__(self) -> None:
            self.posts = []

        def post(self, url, **kw):
            self.posts.append(url)
            return FakeResp()

        async def close(self):
            return None

    async def noop() -> None:
        return None

    monkeypatch.setenv("ELEVENLABS_API_KEY", "sk-test")
    monkeypatch.setattr(tts, "cancel_speak", noop)
    monkeypatch.setattr(tts, "http_session", lambda: FakeSession())

    async def collect():
        return b"".join([c async for c in tts.iter_tts_pcm("elevenlabs", "hi", "JBFqnCBsd6RMkjVDRZzb")])

    assert asyncio.run(collect()) == b"\x00\x01\x02\x03"


def test_iter_eleven_error(monkeypatch) -> None:
    class FakeResp:
        status = 401
        content = None

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_a):
            return False

        async def text(self):
            return "bad key"

    class FakeSession:
        def post(self, *_a, **_k):
            return FakeResp()

        async def close(self):
            return None

    async def noop() -> None:
        return None

    monkeypatch.setenv("ELEVENLABS_API_KEY", "sk-test")
    monkeypatch.setattr(tts, "cancel_speak", noop)
    monkeypatch.setattr(tts, "http_session", lambda: FakeSession())

    async def collect():
        async for _ in tts.iter_tts_pcm("elevenlabs", "hi", "x"):
            pass

    try:
        asyncio.run(collect())
        raise AssertionError("expected RuntimeError")
    except RuntimeError as e:
        assert "401" in str(e)


def test_iter_openai_pcm(monkeypatch) -> None:
    class FakeContent:
        async def iter_any(self):
            yield b"pcm"

    class FakeResp:
        status = 200
        content = FakeContent()

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_a):
            return False

        async def text(self):
            return ""

    class FakeSession:
        def post(self, *_a, **_k):
            return FakeResp()

        async def close(self):
            return None

    async def noop() -> None:
        return None

    monkeypatch.setenv("ZOTO_VIZ_TTS_URL", "http://127.0.0.1:8880")
    monkeypatch.setattr(tts, "cancel_speak", noop)
    monkeypatch.setattr(tts, "http_session", lambda: FakeSession())

    async def collect():
        return b"".join([c async for c in tts.iter_tts_pcm("openai", "hi", "af_heart")])

    assert asyncio.run(collect()) == b"pcm"


def test_iter_piper_pcm(monkeypatch, tmp_path) -> None:
    model = tmp_path / "en.onnx"
    model.write_bytes(b"x")

    class FakeStdout:
        def __init__(self) -> None:
            self.n = 0

        async def read(self, _n):
            self.n += 1
            return b"raw" if self.n == 1 else b""

    class FakeStdin:
        def write(self, _b):
            return None

        async def drain(self):
            return None

        def close(self):
            return None

    class FakeProc:
        returncode = 0
        stdin = FakeStdin()
        stdout = FakeStdout()

        def kill(self):
            return None

        async def wait(self):
            return 0

    async def exec(*_a, **_k):
        return FakeProc()

    async def noop() -> None:
        return None

    monkeypatch.setattr(tts, "piper_bin", lambda: "/usr/bin/piper")
    monkeypatch.setattr(tts, "piper_model", lambda: model)
    monkeypatch.setattr(tts, "cancel_speak", noop)
    monkeypatch.setattr(tts.asyncio, "create_subprocess_exec", exec)

    async def collect():
        return b"".join([c async for c in tts.iter_tts_pcm("piper", "hi", "")])

    assert asyncio.run(collect()) == b"raw"


def test_stream_speak_empty(monkeypatch) -> None:
    async def empty(_e, _t, _v):
        if False:
            yield b"x"
        return

    monkeypatch.setattr(tts, "iter_tts_pcm", empty)
    resp = asyncio.run(tts.stream_speak(Req({"text": "hi"}), "piper", "hi", ""))
    assert resp.status == 502


def test_stream_speak_error(monkeypatch) -> None:
    async def boom(_engine, _text, _voice):
        if False:
            yield b""
        raise RuntimeError("nope")

    monkeypatch.setattr(tts, "iter_tts_pcm", boom)
    resp = asyncio.run(tts.stream_speak(Req({"text": "hi"}), "elevenlabs", "hi", ""))
    assert resp.status == 502
    assert b"nope" in resp.body
