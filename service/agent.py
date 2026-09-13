"""Loopback Ollama proxy. The browser never talks to :11434 itself."""
from __future__ import annotations

import json
import os
import re
from urllib.parse import urlparse
from typing import Any

from aiohttp import ClientSession, ClientTimeout, web

from . import paths
from . import plugins
from .tts import TTS_CAP, api_speak, speak_engine  # noqa: F401

OLLAMA = os.environ.get("ZOTO_VIZ_OLLAMA", "http://127.0.0.1:11434")
DEFAULT_MODEL = "gemma4"
MAX_BODY = 2 * 1024 * 1024
AI_CONTROL_FILE = paths.user_dir() / "ai-control"


def _env_flag(name: str) -> str:
    return os.environ.get(name, "").strip().lower()


def ai_control_on() -> bool:
    """Server-side AI Control. The client boolean is ignored for side effects."""
    env = _env_flag("ZOTO_VIZ_AI_CONTROL")
    if env in {"1", "true", "yes", "on"}:
        return True
    if env in {"0", "false", "no", "off"}:
        return False
    try:
        return AI_CONTROL_FILE.read_text(encoding="utf-8").strip().lower() in {"1", "true", "yes", "on"}
    except OSError:
        return False


def set_ai_control(on: bool) -> None:
    if _env_flag("ZOTO_VIZ_AI_CONTROL") in {"1", "true", "yes", "on"}:
        return  # env wins; the file cannot turn it off
    AI_CONTROL_FILE.parent.mkdir(parents=True, exist_ok=True)
    if on:
        AI_CONTROL_FILE.write_text("1\n", encoding="utf-8")
        os.chmod(AI_CONTROL_FILE, 0o600)
        return
    try:
        AI_CONTROL_FILE.unlink()
    except FileNotFoundError:
        pass

SYSTEM = """You are the zoto-viz local operator. You run on this machine via Ollama.
You help the user understand LAN traffic, draft view plugins, and (only when AI Control is on) change UI settings.
Never invent packet contents. Prefer short, concrete observations.
When drafting a plugin, emit a single YAML document in a fenced yaml block matching the view-plugin schema (id, name, version, engine; graph needs base). Optional TypeScript uses runtime: typescript and entry plus capabilities.
If the user asks to change settings and AI Control is off, refuse and explain how to enable it.
When AI Control is on and a setting should change, emit a fenced block:
```settings
{"theme":"matrix","dream":true,"camera":"auto","chrome":"top"}
```
Only those keys are applied. Do not claim a change happened if Control is off.
"""


def ollama_url() -> str:
    """Reject anything other than loopback so the proxy never talks to a LAN LLM."""
    raw = OLLAMA.strip() or "http://127.0.0.1:11434"
    host = (urlparse(raw).hostname or "").lower()
    if host not in {"127.0.0.1", "localhost", "::1"}:
        raise ValueError("Ollama proxy is loopback-only")
    return raw.rstrip("/")


def _model(body: dict[str, Any]) -> str:
    raw = str(body.get("model") or DEFAULT_MODEL)
    if not re.fullmatch(r"[A-Za-z0-9._:-]{1,64}", raw):
        return DEFAULT_MODEL
    return raw


def match_model(requested: str, names: list[str]) -> str:
    """Map a short tag like gemma4 to an installed Ollama name (gemma4:e4b)."""
    names = [str(n) for n in names if n]
    if requested in names:
        return requested
    hits = [n for n in names if n == requested or n.startswith(requested + ":")]
    if not hits:
        return requested
    for pref in ("e2b-it-qat", "e2b", "latest", "e4b"):
        want = f"{requested}:{pref}"
        if want in hits:
            return want
        for n in hits:
            if n.endswith(f":{pref}"):
                return n
    return sorted(hits)[0]


def chat_options(model: str) -> dict[str, Any]:
    """Ollama chat options. Gemma 4 E2B/E4B on 0.31.x abort on partial GPU offload."""
    opts: dict[str, Any] = {"temperature": 0.3}
    if not str(model).startswith("gemma4"):
        return opts
    raw = os.environ.get("ZOTO_VIZ_OLLAMA_NUM_GPU", "").strip()
    if raw:
        try:
            opts["num_gpu"] = int(raw)
        except ValueError:
            opts["num_gpu"] = 0
    else:
        opts["num_gpu"] = 0
    opts["num_ctx"] = 2048
    return opts


def _tag_names(data: dict[str, Any]) -> list[str]:
    return [m.get("name") for m in (data.get("models") or []) if isinstance(m, dict) and m.get("name")]


async def api_status(_: web.Request) -> web.Response:
    try:
        base = ollama_url()
        timeout = ClientTimeout(total=2)
        async with ClientSession(timeout=timeout) as s:
            async with s.get(f"{base}/api/tags") as r:
                data = await r.json()
        names = _tag_names(data)
        return web.json_response({
            "ok": True,
            "host": base,
            "model": match_model(DEFAULT_MODEL, names),
            "models": names,
            "hasGemma": any(str(n).startswith("gemma4") for n in names),
            "aiControl": ai_control_on(),
            "tts": speak_engine(),
        })
    except Exception as e:
        return web.json_response({
            "ok": False, "host": OLLAMA, "error": str(e), "model": DEFAULT_MODEL,
            "aiControl": ai_control_on(),
            "tts": speak_engine(),
        })


def _redact_state(state: dict[str, Any], redact: bool) -> dict[str, Any]:
    devices = []
    for d in (state.get("devices") or [])[:24]:
        if not isinstance(d, dict):
            continue
        row = {
            "ip": "x.x.x.x" if redact else d.get("ip"),
            "role": d.get("role"),
            "kind": d.get("kind"),
            "bytes": (d.get("bytes_in") or 0) + (d.get("bytes_out") or 0),
            "rate": d.get("rate"),
        }
        if not redact:
            row["name"] = (d.get("names") or [d.get("ip")])[:1]
        devices.append(row)
    return {"devices": devices, "flows": len(state.get("flows") or [])}


async def api_chat(req: web.Request) -> web.StreamResponse:
    if getattr(req, "content_length", None) and req.content_length > MAX_BODY:
        return web.json_response({"error": "body too large"}, status=413)
    if req.content_type and "json" not in req.content_type:
        return web.json_response({"error": "json required"}, status=400)
    try:
        body = await req.json()
    except Exception:
        return web.json_response({"error": "invalid json"}, status=400)
    if not isinstance(body, dict):
        return web.json_response({"error": "object required"}, status=400)
    messages = body.get("messages")
    if not isinstance(messages, list) or not messages:
        return web.json_response({"error": "messages required"}, status=400)
    control = ai_control_on()
    redact = bool(body.get("redact"))
    state = req.app["state"]
    try:
        snap = _redact_state({
            "devices": list(state.devices.values()),
            "flows": list(getattr(state, "flows", {}).values()),
        }, redact)
    except Exception:
        snap = {"devices": [], "flows": 0}

    sys_msg = SYSTEM + f"\nAI Control is {'ON' if control else 'OFF'}.\nCurrent snapshot: {json.dumps(snap)[:2500]}"
    ollama_msgs: list[dict[str, Any]] = [{"role": "system", "content": sys_msg}]
    for m in messages[-12:]:
        if not isinstance(m, dict):
            continue
        role = m.get("role")
        if role not in ("user", "assistant"):
            continue
        content = str(m.get("content") or "")[:8000]
        item: dict[str, Any] = {"role": role, "content": content}
        images = m.get("images")
        if isinstance(images, list) and images:
            item["images"] = [str(x) for x in images[:1]][:1]
        ollama_msgs.append(item)

    payload = {"model": _model(body), "messages": ollama_msgs, "stream": True, "options": chat_options(_model(body))}
    try:
        base = ollama_url()
    except ValueError as e:
        return web.json_response({"error": str(e)}, status=400)
    resp = web.StreamResponse(status=200, headers={"Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store"})
    await resp.prepare(req)
    try:
        timeout = ClientTimeout(total=120)
        async with ClientSession(timeout=timeout) as s:
            try:
                async with s.get(f"{base}/api/tags") as tags:
                    payload["model"] = match_model(_model(body), _tag_names(await tags.json()))
            except Exception:
                pass
            payload["options"] = chat_options(payload["model"])
            async with s.post(f"{base}/api/chat", json=payload) as r:
                async for chunk in r.content.iter_any():
                    await resp.write(chunk)
    except Exception as e:
        await resp.write(json.dumps({"error": str(e), "done": True}).encode())
    await resp.write_eof()
    return resp


async def api_draft_plugin(req: web.Request) -> web.Response:
    """Validate YAML from the model and optionally install when AI Control is on."""
    try:
        body = await req.json()
    except Exception:
        return web.json_response({"error": "invalid json"}, status=400)
    yaml_text = str(body.get("yaml") or "")
    if not yaml_text.strip():
        return web.json_response({"error": "yaml required"}, status=400)
    import yaml
    try:
        doc = yaml.safe_load(yaml_text)
        plugins.validate_doc(doc)
    except Exception as e:
        return web.json_response({"ok": False, "error": str(e)})
    if not ai_control_on() or not body.get("install"):
        return web.json_response({"ok": True, "preview": doc, "installed": False, "aiControl": ai_control_on()})
    dest = plugins.DIR / f"{doc['id']}.yml"
    dest.write_text(yaml_text, encoding="utf-8")
    return web.json_response({"ok": True, "preview": doc, "installed": True, "file": str(dest), "aiControl": True})


async def api_control(req: web.Request) -> web.Response:
    """PUT {on: bool} writes ~/.zoto-viz/ai-control. GET returns the server flag."""
    if req.method == "PUT":
        try:
            body = await req.json()
        except Exception:
            return web.json_response({"error": "invalid json"}, status=400)
        if not isinstance(body, dict):
            return web.json_response({"error": "object required"}, status=400)
        set_ai_control(bool(body.get("on")))
    return web.json_response({"ok": True, "aiControl": ai_control_on(), "env": _env_flag("ZOTO_VIZ_AI_CONTROL") or None})
