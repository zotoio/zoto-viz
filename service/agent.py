"""Loopback Ollama proxy. The browser never talks to :11434 itself."""
from __future__ import annotations

import json
import os
import re
from urllib.parse import urlparse
from typing import Any

from aiohttp import ClientSession, ClientTimeout, web

from . import memory
from . import paths
from . import plugins
from .tts import TTS_CAP, api_speak, speak_engine  # noqa: F401

OLLAMA = os.environ.get("ZOTO_VIZ_OLLAMA", "http://127.0.0.1:11434")
DEFAULT_MODEL = "gemma4"
DEFAULT_NUM_CTX = 2048
MIN_NUM_CTX = 512
MAX_NUM_CTX = 131072
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
This conversation is persistent on the monitor. Continue where you left off. If a session brief is present, it is the same thread after a context-window roll — do not greet as if new. Use listed memories when they apply; do not invent facts that are not in memories, the brief, or the snapshot.
Each user turn may include a Screen HUD object (short keys): m mode, th theme, ch chrome, cam, sel selection, p panel, d dream, mg 0=no merge, rd redact, st stats, hide hidden layers, fd feed, q overlay lines. Use it to read what is on screen before analysing traffic or proposing settings.
When the user states a lasting fact, preference, name, or device mapping, emit a fenced memory block with one short line (or JSON {"text":"..."}):
```memory
the nest speaker is in the kitchen
```
Do not emit memory for ephemeral traffic. If they say to forget something, acknowledge it; the monitor drops matching memories.
When drafting a plugin, emit a single YAML document in a fenced yaml block matching the view-plugin schema (id, name, version, engine; graph needs base). Optional TypeScript uses runtime: typescript and entry plus capabilities.
If the user asks to change settings and AI Control is off, refuse and explain how to enable it.
When AI Control is on and a setting should change, emit a fenced block:
```settings
{"theme":"matrix","dream":true,"camera":"auto","chrome":"top","mode":"talkers","redact":false,"merge":true,"feed":{"on":true,"source":"transcript","layout":"ticker"},"show":{"internet":false}}
```
Allowed keys: theme, dream, camera (auto|off), chrome (top|left|right), mode (a view id from the HUD), redact, merge, feed (on, source traffic|transcript|both, layout ticker|bars|both, scope lan|selected|any), show (lan, internet, multicast, offline, labels).
Prefer hiding noisy layers (multicast, internet) or switching mode/feed when the graph is cluttered. Do not claim a change happened if Control is off.
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


def _num_ctx() -> int:
    """Roll budget. Ollama's default window is used unless ZOTO_VIZ_OLLAMA_NUM_CTX is set."""
    raw = os.environ.get("ZOTO_VIZ_OLLAMA_NUM_CTX", "").strip()
    if not raw:
        return DEFAULT_NUM_CTX
    try:
        n = int(raw)
    except ValueError:
        return DEFAULT_NUM_CTX
    return max(MIN_NUM_CTX, min(MAX_NUM_CTX, n))


def chat_options(model: str) -> dict[str, Any]:
    """Ollama chat options. Gemma 4 E2B/E4B on 0.31.x abort on partial GPU offload."""
    opts: dict[str, Any] = {"temperature": 0.3}
    raw_ctx = os.environ.get("ZOTO_VIZ_OLLAMA_NUM_CTX", "").strip()
    if raw_ctx:
        try:
            opts["num_ctx"] = max(MIN_NUM_CTX, min(MAX_NUM_CTX, int(raw_ctx)))
        except ValueError:
            pass
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
    scored: list[tuple[int, dict[str, Any]]] = []
    for d in state.get("devices") or []:
        if not isinstance(d, dict):
            continue
        b = int(d.get("bytes_in") or 0) + int(d.get("bytes_out") or 0)
        scored.append((b, d))
    scored.sort(key=lambda x: x[0], reverse=True)
    top: list[dict[str, Any]] = []
    for b, d in scored[:6]:
        names = d.get("names") or [d.get("ip")]
        n = str((names[0] if names else "") or "")[:24]
        if redact:
            n = "x"
        row: dict[str, Any] = {}
        if n:
            row["n"] = n
        if d.get("role"):
            row["r"] = d.get("role")
        if d.get("kind"):
            row["k"] = d.get("kind")
        if b:
            row["b"] = b
        if d.get("rate"):
            row["v"] = d.get("rate")
        if row:
            top.append(row)
    return {"n": len(scored), "fl": len(state.get("flows") or []), "top": top}


_THINK_XML = re.compile(r"<think>([\s\S]*?)</think>", re.I)


def parse_ollama_chat(raw: str) -> tuple[str, str]:
    """Return (thinking, content) from an Ollama NDJSON (or single-object) stream."""
    thinking_bits: list[str] = []
    content_bits: list[str] = []
    trimmed = (raw or "").strip()
    if trimmed.startswith("{") and "\n" not in trimmed:
        try:
            j = json.loads(trimmed)
            if isinstance(j, dict):
                if j.get("error"):
                    return "", str(j["error"])
                msg = j.get("message")
                if isinstance(msg, dict):
                    if msg.get("thinking"):
                        thinking_bits.append(str(msg["thinking"]))
                    if msg.get("content"):
                        content_bits.append(str(msg["content"]))
        except json.JSONDecodeError:
            pass
        else:
            if thinking_bits or content_bits:
                return _split_think_tags("".join(thinking_bits), "".join(content_bits))
    for line in (raw or "").split("\n"):
        t = line.strip()
        if not t:
            continue
        try:
            j = json.loads(t)
        except json.JSONDecodeError:
            content_bits.append(t)
            continue
        if not isinstance(j, dict):
            content_bits.append(t)
            continue
        if j.get("error"):
            return "".join(thinking_bits), str(j["error"])
        msg = j.get("message")
        if isinstance(msg, dict):
            if msg.get("thinking"):
                thinking_bits.append(str(msg["thinking"]))
            if msg.get("content"):
                content_bits.append(str(msg["content"]))
    content = "".join(content_bits) or (raw[:2000] if not thinking_bits else "")
    return _split_think_tags("".join(thinking_bits), content)


def _split_think_tags(thinking: str, content: str) -> tuple[str, str]:
    tagged = _THINK_XML.findall(content or "")
    if tagged:
        thinking = "\n".join(x for x in [thinking, *tagged] if x).strip()
        content = _THINK_XML.sub("", content).strip()
    return thinking.strip(), content


def parse_ollama_stream(raw: str) -> str:
    return parse_ollama_chat(raw)[1]


def _last_user(messages: list[Any]) -> str:
    user = ""
    for m in messages:
        if not isinstance(m, dict) or m.get("role") != "user":
            continue
        user = str(m.get("content") or "")[:8000]
    return user


def _snapshot(state: Any, redact: bool) -> dict[str, Any]:
    try:
        return _redact_state({
            "devices": list(state.devices.values()),
            "flows": list(getattr(state, "flows", {}).values()),
        }, redact)
    except Exception:
        return {"n": 0, "fl": 0, "top": []}


_IP = re.compile(r"\b\d{1,3}(?:\.\d{1,3}){3}\b")
HUD_CAP = 700
_SHOW_HIDE = (("internet", "inet"), ("multicast", "mc"), ("offline", "off"), ("labels", "lbl"), ("lan", "lan"))


def _clip(val: Any, n: int) -> str:
    return re.sub(r"\s+", " ", str(val or "")).strip()[:n]


def compact_hud(dom: dict[str, Any], *, redact: bool = False) -> dict[str, Any]:
    """Short-key HUD. Drops empties and default-on layers so 2k ctx still has room."""
    out: dict[str, Any] = {}
    mode = _clip(dom.get("m") or dom.get("mode"), 32)
    if mode:
        out["m"] = mode
    theme = _clip(dom.get("th") or dom.get("theme"), 24)
    if theme:
        out["th"] = theme
    chrome = _clip(dom.get("ch") or dom.get("chrome"), 8)
    if chrome:
        out["ch"] = chrome
    cam = _clip(dom.get("cam") or dom.get("camera"), 8)
    if cam:
        out["cam"] = cam
    sel = dom.get("sel") if "sel" in dom else dom.get("selected")
    if sel:
        s = _clip(sel, 40)
        out["sel"] = _IP.sub("x.x.x.x", s) if redact else s
    panel = _clip(dom.get("p") or dom.get("panel") or dom.get("hint"), 48)
    if panel:
        out["p"] = _IP.sub("x.x.x.x", panel) if redact else panel
    if dom.get("d") in (1, True) or dom.get("dream") is True:
        out["d"] = 1
    merge = dom.get("mg") if "mg" in dom else dom.get("merge")
    if merge in (0, False):
        out["mg"] = 0
    if dom.get("rd") in (1, True) or dom.get("redact") is True:
        out["rd"] = 1
    st = dom.get("st")
    if not isinstance(st, str) or not st.strip():
        stats = dom.get("stats") if isinstance(dom.get("stats"), dict) else {}
        bits = [
            _clip(stats.get("pps"), 12),
            _clip(stats.get("bps"), 16),
            _clip(stats.get("lan"), 16),
            _clip(stats.get("services"), 16),
            _clip(stats.get("flows"), 16),
            _clip(stats.get("net"), 40),
        ]
        st = " ".join(x for x in bits if x)
    st = _clip(st, 80)
    if st:
        out["st"] = _IP.sub("x.x.x.x", st) if redact else st
    hide = dom.get("hide")
    if isinstance(hide, str) and hide.strip():
        out["hide"] = _clip(hide, 40)
    else:
        show = dom.get("show") if isinstance(dom.get("show"), dict) else {}
        dropped = [short for key, short in _SHOW_HIDE if show.get(key) is False]
        if dropped:
            out["hide"] = ",".join(dropped)
    feed = dom.get("feed") if isinstance(dom.get("feed"), dict) else None
    fd = dom.get("fd")
    if isinstance(fd, str) and fd.strip():
        out["fd"] = _clip(fd, 40)
    elif isinstance(feed, dict):
        if feed.get("on") is False:
            out["fd"] = "off"
        else:
            parts = [str(feed.get("layout") or ""), str(feed.get("source") or ""), str(feed.get("scope") or "")]
            packed = "/".join(p for p in parts if p)
            if packed:
                out["fd"] = packed[:40]
    lines = dom.get("q")
    if not isinstance(lines, list):
        lines = (feed or {}).get("lines") if isinstance(feed, dict) else None
    if isinstance(lines, list):
        q = []
        for line in lines[:3]:
            s = _clip(line, 60)
            if redact:
                s = _IP.sub("x.x.x.x", s)
            if s:
                q.append(s)
        if q:
            out["q"] = q
    return out


def _parse_view(body: dict[str, Any], redact: bool) -> str:
    """Packed HUD for the system prompt. Graph JPEGs are ignored."""
    view = body.get("view")
    if not isinstance(view, dict):
        return ""
    raw = view.get("hud") if isinstance(view.get("hud"), dict) else view.get("dom")
    if not isinstance(raw, dict):
        return ""
    packed = compact_hud(raw, redact=redact)
    if not packed:
        return ""
    return "\nScreen: " + json.dumps(packed, ensure_ascii=False, separators=(",", ":"))[:HUD_CAP]


def _remember_reply(user: str, reply: str, *, redact: bool, thinking: str = "") -> None:
    if not reply and not thinking:
        return
    memory.append_message("assistant", reply, thinking=thinking)
    if reply:
        memory.harvest(user, reply, redact=redact)


def _ctx_overflow(raw: bytes | str) -> bool:
    t = raw.decode("utf-8", "replace") if isinstance(raw, (bytes, bytearray)) else str(raw or "")
    low = t.lower()
    return "exceed_context_size" in t or "exceeds the available context" in low


def _chat_budget(has_image: bool) -> int:
    frac = 0.4 if has_image else 0.6
    return max(256, int(_num_ctx() * frac))


def _chat_messages(
    messages: list[Any], *, snap: dict[str, Any], user: str, view_note: str = "",
    redact: bool = False, has_image: bool = False, force_roll: bool = False, keep: int | None = None,
) -> list[dict[str, Any]]:
    control = ai_control_on()
    snap_cap = 480 if view_note else 720
    sys_msg = (
        SYSTEM
        + f"\nAI Control is {'ON' if control else 'OFF'}.\n"
        + f"LAN: {json.dumps(snap, ensure_ascii=False, separators=(',', ':'))[:snap_cap]}"
        + memory.inject_block(user)
        + view_note
    )
    extra = memory.estimate_tokens(sys_msg)
    memory.maybe_roll(
        extra_tokens=extra,
        budget_tokens=_chat_budget(has_image),
        keep=keep if keep is not None else memory.ROLL_KEEP,
        redact=redact,
        force=force_roll,
    )
    ollama_msgs: list[dict[str, Any]] = [{"role": "system", "content": sys_msg}]
    tail = memory.ollama_tail()
    src = tail if tail else [
        {"role": m.get("role"), "content": str(m.get("content") or "")[:memory.OLLAMA_LAST_CAP]}
        for m in messages[-12:]
        if isinstance(m, dict) and m.get("role") in ("user", "assistant")
    ]
    for m in src:
        role = m.get("role")
        if role not in ("user", "assistant"):
            continue
        ollama_msgs.append({"role": role, "content": str(m.get("content") or "")[:memory.OLLAMA_LAST_CAP]})
    return ollama_msgs


async def _pipe_ollama(
    session: ClientSession,
    base: str,
    payload: dict[str, Any],
    resp: web.StreamResponse,
    *,
    hold_overflow: bool = True,
) -> tuple[bytearray, bool]:
    """Stream Ollama NDJSON to the browser. If the first payload is a context overflow, hold it when asked."""
    buf = bytearray()
    streamed = False
    async with session.post(f"{base}/api/chat", json=payload) as r:
        async for chunk in r.content.iter_any():
            buf.extend(chunk)
            if hold_overflow and not streamed and _ctx_overflow(buf):
                return buf, False
            await resp.write(chunk)
            streamed = True
    return buf, streamed


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
    try:
        base = ollama_url()
    except ValueError as e:
        return web.json_response({"error": str(e)}, status=400)
    redact = bool(body.get("redact"))
    snap = _snapshot(req.app["state"], redact)

    user = _last_user(messages)
    view_note = _parse_view(body, redact)
    if user:
        memory.append_message("user", user)
    ollama_msgs = _chat_messages(
        messages, snap=snap, user=user, view_note=view_note, redact=redact, has_image=False,
    )

    payload = {
        "model": _model(body),
        "messages": ollama_msgs,
        "stream": True,
        "think": True,
        "options": chat_options(_model(body)),
    }
    resp = web.StreamResponse(status=200, headers={"Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store"})
    await resp.prepare(req)
    buf = bytearray()
    try:
        timeout = ClientTimeout(total=120)
        async with ClientSession(timeout=timeout) as s:
            try:
                async with s.get(f"{base}/api/tags") as tags:
                    payload["model"] = match_model(_model(body), _tag_names(await tags.json()))
            except Exception:
                pass
            payload["options"] = chat_options(payload["model"])
            buf, streamed = await _pipe_ollama(s, base, payload, resp)
            if _ctx_overflow(buf) and not streamed:
                payload["messages"] = _chat_messages(
                    messages, snap=snap, user=user, view_note=view_note,
                    redact=redact, has_image=False, force_roll=True, keep=2,
                )
                buf, _ = await _pipe_ollama(s, base, payload, resp, hold_overflow=False)
    except Exception as e:
        await resp.write(json.dumps({"error": str(e), "done": True}).encode())
    thinking, reply = parse_ollama_chat(buf.decode("utf-8", "replace"))
    _remember_reply(user, reply, redact=redact, thinking=thinking)
    await resp.write_eof()
    return resp


async def api_history(req: web.Request) -> web.Response:
    """GET the persisted transcript. DELETE clears the log (memories stay)."""
    if req.method == "DELETE":
        memory.clear_conversation()
        return web.json_response({"ok": True, "messages": []})
    return web.json_response({
        "ok": True,
        "messages": memory.ui_messages(),
        "memories": memory.list_memories(kind="memory"),
    })


async def api_memories(req: web.Request) -> web.Response:
    """GET listed memories. POST {text} stores one. DELETE {id?} drops one or all."""
    if req.method == "POST":
        try:
            body = await req.json()
        except Exception:
            return web.json_response({"error": "invalid json"}, status=400)
        if not isinstance(body, dict):
            return web.json_response({"error": "object required"}, status=400)
        row = memory.add_memory(str(body.get("text") or ""), kind="memory")
        if not row:
            return web.json_response({"error": "text required"}, status=400)
        return web.json_response({"ok": True, "memory": row, "memories": memory.list_memories(kind="memory")})
    if req.method == "DELETE":
        try:
            body = await req.json() if req.content_type and "json" in req.content_type else {}
        except Exception:
            body = {}
        if not isinstance(body, dict):
            body = {}
        query = getattr(getattr(req, "rel_url", None), "query", {}) or {}
        mem_id = str(body.get("id") or query.get("id") or "")
        if mem_id:
            ok = memory.delete_memory(mem_id)
            return web.json_response({"ok": ok, "memories": memory.list_memories(kind="memory")})
        memory.clear_memories()
        return web.json_response({"ok": True, "memories": []})
    return web.json_response({"ok": True, "memories": memory.list_memories(kind="memory")})


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
