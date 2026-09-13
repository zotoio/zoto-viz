"""Spoken replies: stream PCM from ElevenLabs, a loopback Kokoro-style server, or Piper; espeak last."""
from __future__ import annotations

import asyncio
import json
import os
import re
import shutil
from collections.abc import AsyncIterator
from pathlib import Path
from urllib.parse import quote, urlparse

from aiohttp import ClientSession, ClientTimeout, web

TTS_CAP = 2500
STREAM_TTS = frozenset({"elevenlabs", "openai", "piper"})
ELEVEN_HOSTS = frozenset({
    "api.elevenlabs.io",
    "api.us.elevenlabs.io",
    "api.eu.residency.elevenlabs.io",
    "api.in.residency.elevenlabs.io",
    "api.sg.residency.elevenlabs.io",
})
ELEVEN_VOICE = "JBFqnCBsd6RMkjVDRZzb"
KOKORO_VOICE = "af_heart"

_speak_proc: asyncio.subprocess.Process | None = None
_speak_session: ClientSession | None = None


def tts_mode() -> str:
    return (os.environ.get("ZOTO_VIZ_TTS") or "auto").strip().lower() or "auto"


def eleven_key() -> str:
    return (os.environ.get("ELEVENLABS_API_KEY") or os.environ.get("XI_API_KEY") or "").strip()


def eleven_base() -> str:
    raw = (os.environ.get("ELEVENLABS_API_BASE") or "https://api.elevenlabs.io").strip()
    host = (urlparse(raw).hostname or "").lower()
    if host not in ELEVEN_HOSTS:
        return "https://api.elevenlabs.io"
    return raw.rstrip("/")


def tts_url() -> str | None:
    """OpenAI-compatible speech endpoint (Kokoro-FastAPI). Loopback only."""
    raw = (os.environ.get("ZOTO_VIZ_TTS_URL") or "").strip()
    if not raw:
        return None
    host = (urlparse(raw).hostname or "").lower()
    if host not in {"127.0.0.1", "localhost", "::1"}:
        raise ValueError("TTS URL is loopback-only")
    return raw.rstrip("/")


def speech_url(base: str) -> str:
    b = base.rstrip("/")
    return f"{b}/audio/speech" if b.endswith("/v1") else f"{b}/v1/audio/speech"


def piper_bin() -> str | None:
    return shutil.which("piper") or shutil.which("piper-tts")


def piper_model() -> Path | None:
    raw = (os.environ.get("ZOTO_VIZ_PIPER_MODEL") or "").strip()
    if raw:
        p = Path(raw).expanduser()
        return p if p.is_file() else None
    for d in (Path.home() / ".local/share/piper", Path("/usr/share/piper")):
        if not d.is_dir():
            continue
        onnx = sorted(d.glob("**/*.onnx"))
        if onnx:
            return onnx[0]
    return None


def piper_rate(model: Path) -> int:
    for js in (model.with_suffix(".onnx.json"), Path(str(model) + ".json"), model.with_suffix(".json")):
        try:
            data = json.loads(js.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        try:
            rate = int((data.get("audio") or {}).get("sample_rate") or 0)
        except (TypeError, ValueError):
            continue
        if 8000 <= rate <= 48000:
            return rate
    return 22050


def espeak_engine() -> str | None:
    if shutil.which("espeak-ng"):
        return "espeak-ng"
    if shutil.which("espeak"):
        return "espeak"
    if shutil.which("spd-say"):
        return "spd-say"
    return None


def speak_engine() -> str | None:
    """Neural stream if configured, else espeak / speech-dispatcher."""
    mode = tts_mode()
    if mode in {"0", "off", "none"}:
        return None
    key = eleven_key()
    try:
        url = tts_url()
    except ValueError:
        url = None
    piper = piper_bin() if piper_model() else None
    if mode == "elevenlabs":
        return "elevenlabs" if key else None
    if mode in {"openai", "kokoro"}:
        return "openai" if url else None
    if mode == "piper":
        return "piper" if piper else None
    if mode in {"espeak", "espeak-ng", "spd-say"}:
        return espeak_engine()
    if key:
        return "elevenlabs"
    if url:
        return "openai"
    if piper:
        return "piper"
    return espeak_engine()


def tts_rate(engine: str) -> int:
    if engine == "piper":
        model = piper_model()
        return piper_rate(model) if model else 22050
    raw = (os.environ.get("ZOTO_VIZ_TTS_RATE") or "").strip()
    try:
        n = int(raw)
        if 8000 <= n <= 48000:
            return n
    except ValueError:
        pass
    return 24000


def tts_voice(raw: str, engine: str) -> str:
    if engine == "elevenlabs":
        default = os.environ.get("ELEVENLABS_VOICE_ID") or os.environ.get("ZOTO_VIZ_TTS_VOICE") or ELEVEN_VOICE
    else:
        default = os.environ.get("ZOTO_VIZ_TTS_VOICE") or KOKORO_VOICE
    s = (raw or default).strip()[:80]
    if re.fullmatch(r"[A-Za-z0-9._+-]+", s):
        return s
    return default


def _speak_cmd(engine: str, text: str) -> list[str]:
    if engine in {"espeak-ng", "espeak"}:
        bin = shutil.which(engine) or engine
        return [bin, "-v", "en", "-s", "160", text]
    return [shutil.which("spd-say") or "spd-say", "-w", "-l", "en", text]


def http_session() -> ClientSession:
    return ClientSession(timeout=ClientTimeout(total=60, sock_read=30))


async def cancel_speak() -> None:
    global _speak_proc, _speak_session
    sess = _speak_session
    _speak_session = None
    if sess is not None:
        await sess.close()
    proc = _speak_proc
    _speak_proc = None
    if proc is not None and proc.returncode is None:
        try:
            proc.kill()
        except ProcessLookupError:
            pass
        try:
            await asyncio.wait_for(proc.wait(), timeout=2)
        except (asyncio.TimeoutError, ProcessLookupError):
            pass
    spd = shutil.which("spd-say")
    if not spd:
        return
    stopper = await asyncio.create_subprocess_exec(
        spd, "-C", stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL,
    )
    try:
        await asyncio.wait_for(stopper.wait(), timeout=2)
    except (asyncio.TimeoutError, ProcessLookupError):
        try:
            stopper.kill()
        except ProcessLookupError:
            pass


async def host_say(text: str) -> str | None:
    """espeak / speech-dispatcher on the monitor host (no stream)."""
    global _speak_proc
    engine = speak_engine()
    if engine not in {"espeak-ng", "espeak", "spd-say"}:
        return None
    await cancel_speak()
    proc = await asyncio.create_subprocess_exec(
        *_speak_cmd(engine, text),
        stdin=asyncio.subprocess.DEVNULL,
        stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.DEVNULL,
    )
    _speak_proc = proc
    try:
        await asyncio.wait_for(proc.wait(), timeout=60)
    except asyncio.TimeoutError:
        await cancel_speak()
        return None
    return engine


async def iter_tts_pcm(engine: str, text: str, voice: str) -> AsyncIterator[bytes]:
    if engine == "elevenlabs":
        async for chunk in _iter_eleven(text, voice):
            yield chunk
        return
    if engine == "openai":
        async for chunk in _iter_openai(text, voice):
            yield chunk
        return
    if engine == "piper":
        async for chunk in _iter_piper(text):
            yield chunk


async def _iter_eleven(text: str, voice: str) -> AsyncIterator[bytes]:
    global _speak_session
    key = eleven_key()
    if not key:
        raise RuntimeError("ELEVENLABS_API_KEY is not set")
    vid = tts_voice(voice, "elevenlabs")
    url = (
        f"{eleven_base()}/v1/text-to-speech/{quote(vid, safe='')}/stream"
        f"?output_format=pcm_{tts_rate('elevenlabs')}"
    )
    model = (os.environ.get("ELEVENLABS_MODEL") or os.environ.get("ZOTO_VIZ_TTS_MODEL") or "eleven_flash_v2_5").strip()
    await cancel_speak()
    s = http_session()
    _speak_session = s
    try:
        async with s.post(
            url,
            headers={"xi-api-key": key, "accept": "application/octet-stream"},
            json={"text": text, "model_id": model or "eleven_flash_v2_5"},
        ) as r:
            if r.status >= 400:
                raise RuntimeError(f"ElevenLabs {r.status}: {(await r.text())[:240]}")
            async for chunk in r.content.iter_any():
                if chunk:
                    yield chunk
    finally:
        if _speak_session is s:
            _speak_session = None
        await s.close()


async def _iter_openai(text: str, voice: str) -> AsyncIterator[bytes]:
    global _speak_session
    base = tts_url()
    if not base:
        raise RuntimeError("ZOTO_VIZ_TTS_URL is not set")
    model = (os.environ.get("ZOTO_VIZ_TTS_MODEL") or "kokoro").strip() or "kokoro"
    await cancel_speak()
    s = http_session()
    _speak_session = s
    try:
        async with s.post(
            speech_url(base),
            json={
                "model": model,
                "input": text,
                "voice": tts_voice(voice, "openai"),
                "response_format": "pcm",
                "stream": True,
            },
        ) as r:
            if r.status >= 400:
                raise RuntimeError(f"TTS {r.status}: {(await r.text())[:240]}")
            async for chunk in r.content.iter_any():
                if chunk:
                    yield chunk
    finally:
        if _speak_session is s:
            _speak_session = None
        await s.close()


async def _iter_piper(text: str) -> AsyncIterator[bytes]:
    global _speak_proc
    bin = piper_bin()
    model = piper_model()
    if not bin or not model:
        raise RuntimeError("piper binary or model missing")
    await cancel_speak()
    proc = await asyncio.create_subprocess_exec(
        bin, "-m", str(model), "--output-raw",
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.DEVNULL,
    )
    _speak_proc = proc
    assert proc.stdin and proc.stdout
    proc.stdin.write(text.encode("utf-8", "replace") + b"\n")
    await proc.stdin.drain()
    proc.stdin.close()
    try:
        while True:
            chunk = await proc.stdout.read(4096)
            if not chunk:
                break
            yield chunk
    finally:
        if proc.returncode is None:
            try:
                proc.kill()
            except ProcessLookupError:
                pass
            try:
                await proc.wait()
            except ProcessLookupError:
                pass
        if _speak_proc is proc:
            _speak_proc = None


async def stream_speak(req: web.Request, engine: str, text: str, voice: str) -> web.StreamResponse:
    agen = iter_tts_pcm(engine, text, voice)
    try:
        first = await agen.__anext__()
    except StopAsyncIteration:
        return web.json_response({"error": "TTS produced no audio"}, status=502)
    except Exception as e:
        return web.json_response({"error": str(e)}, status=502)
    rate = tts_rate(engine)
    resp = web.StreamResponse(
        status=200,
        headers={
            "Content-Type": f"audio/pcm;rate={rate}",
            "X-Zoto-Viz-Rate": str(rate),
            "X-Zoto-Viz-Engine": engine,
            "Cache-Control": "no-store",
            "X-Accel-Buffering": "no",
        },
    )
    await resp.prepare(req)
    try:
        if first:
            await resp.write(first)
        async for chunk in agen:
            if chunk:
                await resp.write(chunk)
    finally:
        await agen.aclose()
        await resp.write_eof()
    return resp


async def api_speak(req: web.Request) -> web.StreamResponse:
    """POST {text, voice?} streams PCM or speaks via espeak. DELETE stops it."""
    if req.method == "DELETE":
        await cancel_speak()
        return web.json_response({"ok": True})
    if getattr(req, "content_length", None) and req.content_length > TTS_CAP + 512:
        return web.json_response({"error": "body too large"}, status=413)
    if req.content_type and "json" not in req.content_type:
        return web.json_response({"error": "json required"}, status=400)
    try:
        body = await req.json()
    except Exception:
        return web.json_response({"error": "invalid json"}, status=400)
    if not isinstance(body, dict):
        return web.json_response({"error": "object required"}, status=400)
    text = str(body.get("text") or "").strip()[:TTS_CAP]
    if not text:
        return web.json_response({"error": "text required"}, status=400)
    voice = str(body.get("voice") or "")
    engine = speak_engine()
    if engine in STREAM_TTS:
        return await stream_speak(req, engine, text, voice)
    got = await host_say(text)
    if not got:
        return web.json_response(
            {"error": "no TTS engine — set ELEVENLABS_API_KEY, ZOTO_VIZ_TTS_URL, or install espeak-ng"},
            status=503,
        )
    return web.json_response({"ok": True, "engine": got})
