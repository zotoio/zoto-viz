"""Cursor SDK (@cursor/sdk) sidecar: list models and stream a local agent turn."""
from __future__ import annotations

import asyncio
import json
import os
import shutil
import time
from pathlib import Path
from typing import Any

from aiohttp import web

from . import cursor_stats
from . import paths

DEFAULT_MODEL = "grok-4.6"
KEY_FILE = paths.user_dir() / "cursor-key"
FALLBACK_MODELS: list[dict[str, str]] = [
    {"id": "grok-4.6", "label": "Grok 4.6", "hint": "default"},
    {"id": "grok-4.5", "label": "Grok 4.5"},
    {"id": "grok-4", "label": "Grok 4"},
    {"id": "composer-2.5", "label": "Composer 2.5"},
    {"id": "gpt-5.4", "label": "GPT-5.4"},
    {"id": "claude-opus-4-8", "label": "Claude Opus 4.8"},
    {"id": "gemini-3.1-pro", "label": "Gemini 3.1 Pro"},
    {"id": "auto", "label": "Auto"},
]


def key_path() -> Path:
    return KEY_FILE


def read_key() -> str:
    env = os.environ.get("CURSOR_API_KEY", "").strip()
    if env:
        return env
    try:
        return KEY_FILE.read_text(encoding="utf-8").strip()
    except OSError:
        return ""


def write_key(key: str) -> None:
    KEY_FILE.parent.mkdir(parents=True, exist_ok=True)
    KEY_FILE.write_text(key.strip() + "\n", encoding="utf-8")
    os.chmod(KEY_FILE, 0o600)


def clear_key() -> None:
    try:
        KEY_FILE.unlink()
    except FileNotFoundError:
        pass


def pick_default(ids: list[str]) -> str:
    for name in ids:
        if str(name).lower().startswith("grok"):
            return name
    return DEFAULT_MODEL if DEFAULT_MODEL in ids else (ids[0] if ids else DEFAULT_MODEL)


def bridge_dir() -> Path:
    return paths.repo_root() / "service" / "cursor-bridge"


def node_bin() -> str:
    return shutil.which("node") or "node"


def _env(key: str) -> dict[str, str]:
    env = os.environ.copy()
    env["CURSOR_API_KEY"] = key
    env["ZOTO_VIZ_MCP"] = os.environ.get("ZOTO_VIZ_MCP", "http://127.0.0.1:7020/mcp")
    env["ZOTO_VIZ_REPO_ROOT"] = str(paths.repo_root())
    env["ZOTO_VIZ_CURSOR_STATS"] = str(cursor_stats.stats_path())
    env["ZOTO_VIZ_CURSOR_SESSION"] = str(session_path())
    return env


def session_path() -> Path:
    env = os.environ.get("ZOTO_VIZ_CURSOR_SESSION", "").strip()
    if env:
        return Path(env).expanduser()
    return paths.agent_dir() / "cursor-session.json"


def read_session() -> dict[str, Any]:
    try:
        data = json.loads(session_path().read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return data if isinstance(data, dict) else {}


def clear_session() -> None:
    try:
        session_path().unlink()
    except FileNotFoundError:
        pass


def remember_session(row: dict[str, Any]) -> None:
    agent_id = ""
    stats = row.get("stats") if isinstance(row.get("stats"), dict) else {}
    session = row.get("session") if isinstance(row.get("session"), dict) else {}
    if isinstance(stats, dict):
        agent_id = str(stats.get("agentId") or "")
    if not agent_id and isinstance(session, dict):
        agent_id = str(session.get("agentId") or "")
    if not agent_id:
        return
    dest = session_path()
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(json.dumps({
        "agentId": agent_id,
        "model": str(session.get("model") or stats.get("model") or ""),
        "t": time.time(),
    }) + "\n", encoding="utf-8")
    try:
        os.chmod(dest, 0o600)
    except OSError:
        pass


async def list_models(key: str, *, capture: bool = True) -> dict[str, Any]:
    cli = bridge_dir() / "cli.mjs"
    if not cli.is_file() or not key:
        return {"ok": False, "models": list(FALLBACK_MODELS), "default": DEFAULT_MODEL,
                "error": "missing API key" if not key else "cursor-bridge missing"}
    env = _env(key)
    if not capture:
        env["ZOTO_VIZ_CURSOR_STATS_SKIP"] = "list"
    try:
        proc = await asyncio.create_subprocess_exec(
            node_bin(), str(cli), "list",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=env,
            cwd=str(bridge_dir()),
        )
        out, err = await asyncio.wait_for(proc.communicate(), timeout=25)
    except (OSError, asyncio.TimeoutError) as e:
        return {"ok": False, "models": list(FALLBACK_MODELS), "default": DEFAULT_MODEL, "error": str(e)}
    if proc.returncode != 0:
        msg = (err.decode("utf-8", "replace") or out.decode("utf-8", "replace")).strip() or "list failed"
        return {"ok": False, "models": list(FALLBACK_MODELS), "default": DEFAULT_MODEL, "error": msg[:400]}
    try:
        data = json.loads(out.decode("utf-8", "replace") or "{}")
    except json.JSONDecodeError:
        return {"ok": False, "models": list(FALLBACK_MODELS), "default": DEFAULT_MODEL, "error": "bad list json"}
    if capture and isinstance(data, dict):
        cursor_stats.ingest(data)
    rows = data.get("models") if isinstance(data, dict) else None
    models: list[dict[str, str]] = []
    if isinstance(rows, list):
        for row in rows:
            if not isinstance(row, dict):
                continue
            mid = str(row.get("id") or "").strip()
            if not mid:
                continue
            models.append({
                "id": mid,
                "label": str(row.get("label") or row.get("displayName") or mid),
                "hint": str(row.get("hint") or row.get("description") or ""),
            })
    if not models:
        models = list(FALLBACK_MODELS)
    default = pick_default([m["id"] for m in models])
    return {"ok": True, "models": models, "default": default}


def status_payload() -> dict[str, Any]:
    key = read_key()
    return {
        "configured": bool(key),
        "ok": False,
        "default": DEFAULT_MODEL,
        "models": list(FALLBACK_MODELS),
    }


async def enrich_status() -> dict[str, Any]:
    key = read_key()
    base = status_payload()
    if not key:
        base["error"] = "set CURSOR_API_KEY or paste a key in Settings → Agent"
        return base
    listed = await list_models(key, capture=False)
    base.update(listed)
    base["configured"] = True
    return base


async def stream_chat(
    resp: web.StreamResponse,
    *,
    model: str,
    prompt: str,
    system: str,
    control: bool,
    reset: bool = False,
) -> tuple[str, dict[str, Any]]:
    """Run one Cursor SDK turn; write Ollama-shaped NDJSON onto ``resp``.

    Returns assistant text and the last stats object (tokens / spend).
    """
    key = read_key()
    if not key:
        await resp.write(json.dumps({"error": "Cursor API key missing", "done": True}).encode())
        return "", {}
    cli = bridge_dir() / "cli.mjs"
    if not cli.is_file():
        await resp.write(json.dumps({"error": "cursor-bridge missing", "done": True}).encode())
        return "", {}
    env = _env(key)
    env["ZOTO_VIZ_AI_CONTROL"] = "1" if control else "0"
    try:
        proc = await asyncio.create_subprocess_exec(
            node_bin(), str(cli), "chat",
            "--model", model or DEFAULT_MODEL,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            stdin=asyncio.subprocess.PIPE,
            env=env,
            cwd=str(bridge_dir()),
        )
    except OSError as e:
        await resp.write(json.dumps({"error": str(e), "done": True}).encode())
        return "", {}
    payload = json.dumps({
        "prompt": prompt,
        "system": system,
        "control": control,
        "model": model or DEFAULT_MODEL,
        "reset": reset,
        "agentId": "" if reset else str(read_session().get("agentId") or ""),
    }) + "\n"
    assert proc.stdin and proc.stdout
    proc.stdin.write(payload.encode())
    await proc.stdin.drain()
    proc.stdin.close()
    collected = ""
    last_stats: dict[str, Any] = {}
    try:
        while True:
            line = await proc.stdout.readline()
            if not line:
                break
            await resp.write(line if line.endswith(b"\n") else line + b"\n")
            try:
                row = json.loads(line.decode("utf-8", "replace"))
            except json.JSONDecodeError:
                continue
            if isinstance(row, dict):
                cursor_stats.ingest(row)
                remember_session(row)
                if isinstance(row.get("stats"), dict):
                    last_stats = row["stats"]
                msg = row.get("message") if isinstance(row.get("message"), dict) else {}
                bit = str(msg.get("content") or "")
                if bit:
                    collected += bit
                if row.get("error"):
                    collected = collected or str(row["error"])
    finally:
        try:
            await asyncio.wait_for(proc.wait(), timeout=8)
        except asyncio.TimeoutError:
            proc.kill()
    return collected, last_stats


async def api_key(req: web.Request) -> web.Response:
    if req.method == "DELETE":
        if os.environ.get("CURSOR_API_KEY", "").strip():
            return web.json_response({"ok": False, "error": "CURSOR_API_KEY env wins"}, status=400)
        clear_key()
        return web.json_response({"ok": True, "configured": False})
    if req.method == "PUT":
        try:
            body = await req.json()
        except Exception:
            return web.json_response({"error": "invalid json"}, status=400)
        if not isinstance(body, dict):
            return web.json_response({"error": "object required"}, status=400)
        key = str(body.get("key") or "").strip()
        if not key:
            return web.json_response({"error": "key required"}, status=400)
        write_key(key)
        listed = await list_models(key)
        return web.json_response({"ok": True, "configured": True, **listed})
    return web.json_response({"ok": True, "configured": bool(read_key())})
